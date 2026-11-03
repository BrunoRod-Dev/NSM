import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { z, ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClientEvents, ServerEvents, SendResult } from '../../../packages/contracts/src/index.js';
import { idSchema } from '../../../packages/contracts/src/index.js';
import type { Config } from './config.js';
import { Database } from './db.js';
import { AccountsService, type Identity } from './accounts/accounts.service.js';
import { FriendsService } from './friends/friends.service.js';
import { MessagesService } from './messages/messages.service.js';
import { PresenceService } from './presence/presence.service.js';
import { AppError, unauthorized } from './errors.js';
import { GamesService } from './games/games.service.js';
import { registerGameRoutes } from './games/games.routes.js';

export async function createApp(config: Config, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    bodyLimit: 16384,
    logger: opts.logger ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'], serializers: { req: req => ({ method: req.method, path: req.url?.split('?')[0], remoteAddress: req.ip }) } } : false,
    trustProxy: config.TRUST_PROXY === 'true' ? (_address: string, hop: number) => hop < 1 : false,
  });
  const db = new Database(config.DATABASE_URL);
  const accounts = new AccountsService(db, config.SESSION_DAYS);
  const friends = new FriendsService(db);
  const messages = new MessagesService(db, accounts);
  const cookieName = config.NODE_ENV === 'production' ? '__Host-nsm' : 'nsm.sid';
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", config.APP_ORIGIN.replace(/^http/, 'ws')], imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null } }, hsts: config.NODE_ENV === 'production' });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute', errorResponseBuilder: () => ({ statusCode: 429, error: 'Demasiados intentos. Esperá un minuto y volvé a intentar.', code: 'RATE_LIMIT' }) });
  app.addHook('onRequest', async (request) => {
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method) && request.headers.origin !== config.APP_ORIGIN) throw new AppError(403, 'Origen de la solicitud no permitido.', 'ORIGIN_REJECTED');
  });
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  const identity = (request: FastifyRequest) => accounts.identity(request.cookies[cookieName]);
  const setSession = (reply: FastifyReply, value: string) => reply.setCookie(cookieName, value, { path: '/', httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict', maxAge: config.SESSION_DAYS * 86400 });
  const authLimit = { rateLimit: { max: 8, timeWindow: '1 minute' } };
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? 'Datos inválidos.', code: 'VALIDATION' });
    if (error instanceof AppError) return reply.code(error.status).send({ error: error.message, code: error.code });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'Demasiados intentos. Esperá un minuto.', code: 'RATE_LIMIT' });
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'Solicitud inválida.', code: 'BAD_REQUEST' });
    request.log.error({ requestId: request.id, errorType: error instanceof Error ? error.name : 'unknown' }, 'No se pudo completar la solicitud');
    return reply.code(500).send({ error: 'No se pudo completar la operación. Volvé a intentar.', code: 'INTERNAL_ERROR' });
  });
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, { identity: Identity; token: string }>(app.server, {
    transports: ['websocket'], maxHttpBufferSize: 16384, pingInterval: 10000, pingTimeout: 10000,
    cors: { origin: config.APP_ORIGIN, credentials: true },
    allowRequest: (req, cb) => cb(null, req.headers.origin === config.APP_ORIGIN),
  });
  const presence = new PresenceService(friends, (id, event) => io.to(`user:${id}`).emit('presence:changed', event), () => app.log.error('No se pudo actualizar la presencia'));
  const games = new GamesService(db, config, ids => { for (const id of ids) io.to(`user:${id}`).emit('games:changed'); });
  const gameCleanup = setInterval(() => games.sweep(), 5000);
  gameCleanup.unref();
  function changed(...ids: string[]) {
    for (const id of new Set(ids)) { io.to(`user:${id}`).emit('social:changed'); io.to(`user:${id}`).emit('conversations:changed'); }
  }
  function expireWhere(predicate: (data: { identity: Identity }) => boolean) {
    for (const socket of io.sockets.sockets.values()) if (predicate(socket.data)) { socket.emit('session:expired'); socket.disconnect(true); }
  }
  // Per-account budgets are shared across tabs; no message content enters these maps.
  const budgets = new Map<string, { starts: number; count: number }>();
  const cleanup = setInterval(() => {
    for (const [key, entry] of budgets) if (Date.now() - entry.starts > 60000) budgets.delete(key);
    void db.query('DELETE FROM sessions WHERE expires_at<=now()').catch(() => app.log.error('No se pudieron limpiar sesiones vencidas'));
  }, 60000);
  cleanup.unref();
  io.use(async (socket, next) => {
    try {
      const sessionToken = app.parseCookie(socket.request.headers.cookie ?? '')[cookieName];
      const auth = await accounts.identity(sessionToken);
      socket.data = { identity: auth, token: sessionToken! };
      next();
    } catch { next(new Error('UNAUTHORIZED')); }
  });
  io.on('connection', socket => {
    const userId = socket.data.identity.user.id;
    void socket.join(`user:${userId}`);
    socket.on('disconnect', () => presence.disconnected(userId, socket.id));
    void presence.connected(userId, socket.id).catch(() => app.log.error('No se pudo anunciar la conexión'));
    const expiryTimer = setTimeout(() => { socket.emit('session:expired'); socket.disconnect(true); }, Math.max(0, socket.data.identity.expiresAt.getTime() - Date.now()));
    expiryTimer.unref();
    socket.on('disconnect', () => clearTimeout(expiryTimer));
    socket.on('message:send', async (input, callback) => {
      if (typeof callback !== 'function') return;
      const respond = (result: SendResult) => callback(result);
      try {
        const now = Date.now();
        const budget = budgets.get(userId);
        const current = budget && now - budget.starts < 60000 ? budget : { starts: now, count: 0 };
        budgets.set(userId, current);
        if (++current.count > 60) throw new AppError(429, 'Estás enviando muy rápido. Esperá un minuto.', 'RATE_LIMIT');
        const { message, recipients } = await messages.send(socket.data.token, input);
        // The transaction has committed before acknowledgements and notifications.
        for (const id of recipients) io.to(`user:${id}`).emit('message:new', message);
        respond({ ok: true, message });
      } catch (error) {
        if (error instanceof ZodError) respond({ ok: false, error: 'El mensaje debe tener entre 1 y 2000 caracteres.', code: 'VALIDATION' });
        else if (error instanceof AppError) {
          respond({ ok: false, error: error.message, code: error.code });
          if (error.status === 401) { socket.emit('session:expired'); socket.disconnect(true); }
        } else { app.log.error('No se pudo guardar un mensaje'); respond({ ok: false, error: 'No se pudo guardar el mensaje. Podés reintentar.', code: 'INTERNAL_ERROR' }); }
      }
    });
  });

  app.get('/api/health', async () => { await db.query('SELECT 1'); return { status: 'ok' }; });
  app.post('/api/auth/register', { config: authLimit }, async (request, reply) => {
    const body = z.object({password:z.string(),passwordConfirm:z.string()}).refine(v=>v.password===v.passwordConfirm,{message:'Las contraseñas no coinciden.',path:['passwordConfirm']}).parse(request.body);
    const result = await accounts.register(request.body);
    setSession(reply, result.sessionToken);
    return reply.code(201).send({ user: result.user });
  });
  app.post('/api/auth/login', { config: authLimit }, async (request, reply) => {
    const result = await accounts.login(request.body);
    setSession(reply, result.sessionToken);
    return { user: result.user };
  });
  app.post('/api/auth/recover', { config: authLimit }, async (request, reply) => {
    const result = await accounts.recover(request.body);
    games.leaveUser(result.user.id);
    expireWhere(data => data.identity.user.id === result.user.id);
    setSession(reply, result.sessionToken);
    return { user: result.user, recoveryCode: result.recoveryCode };
  });
  app.get('/api/auth/me', async request => ({ user: (await identity(request)).user }));
  app.post('/api/auth/logout', async (request, reply) => {
    const auth = await identity(request);
    await accounts.logout(auth.sessionHash);
    games.leaveUser(auth.user.id);
    expireWhere(data => data.identity.sessionHash === auth.sessionHash);
    reply.clearCookie(cookieName, { path: '/', httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict' });
    return { ok: true };
  });
  app.patch('/api/account', async request => {
    const auth = await identity(request);
    const body = z.object({ displayName: z.string() }).parse(request.body);
    const user = await accounts.rename(auth.user.id, body.displayName);
    const peers = (await messages.list(user.id)).map(c => c.peer.id);
    changed(user.id, ...await friends.friendIds(user.id), ...peers);
    return { user };
  });
  app.get('/api/social', async request => friends.state((await identity(request)).user, presence.isOnline));
  app.post('/api/friends/requests', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async request => {
    const auth = await identity(request);
    const body = z.object({ username: z.string() }).parse(request.body);
    const peer = await friends.request(auth.user, body.username);
    changed(auth.user.id, peer);
    return { ok: true };
  });
  app.post('/api/friends/requests/:id', async request => {
    const auth = await identity(request);
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
    const peer = await friends.respond(auth.user, id, accept);
    changed(auth.user.id, peer);
    return { ok: true };
  });
  app.post('/api/friends/:id/:action', async request => {
    const auth = await identity(request);
    const { id, action } = z.object({ id: idSchema, action: z.enum(['remove', 'block', 'unblock']) }).parse(request.params);
    await friends.change(auth.user, id, action);
    if (action !== 'unblock') games.revokeContact(auth.user.id, id);
    changed(auth.user.id, id);
    return { ok: true };
  });
  app.get('/api/conversations', async request => ({ conversations: await messages.list((await identity(request)).user.id) }));
  app.get('/api/conversations/:id/messages', async request => {
    const auth = await identity(request);
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const options = z.object({ before: z.coerce.number().int().positive().optional(), after: z.coerce.number().int().nonnegative().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).refine(o => o.before === undefined || o.after === undefined, 'Usá before o after, no ambos.').parse(request.query);
    return messages.history(auth.user.id, id, options);
  });

  await registerGameRoutes(app, games, identity);
  const staticRoot = resolve('dist/web/browser');
  if (existsSync(resolve(staticRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: staticRoot });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && request.headers.accept?.includes('text/html')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'No encontrado.' });
    });
  }
  app.addHook('onClose', async () => {
    clearInterval(cleanup);
    clearInterval(gameCleanup); games.close();
    presence.close();
    await new Promise<void>(resolveClose => io.close(() => resolveClose()));
    await db.close();
  });
  return { app, db, accounts, friends, messages, io, presence, games, config };
}
