import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { Database } from '../src/db.js';
import { prepareTestDatabase } from './database.js';

let server: Awaited<ReturnType<typeof createApp>>;
let base: string;
const origin = 'http://localhost:4200';
const password = 'Una contraseña segura 123!';
const suffix = () => randomUUID().replaceAll('-', '').slice(0, 12);
const sockets: Socket[] = [];
const cookie = (sessionToken: string) => `nsm.sid=${sessionToken}`;
const headers = (sessionToken?: string) => ({ origin, ...(sessionToken ? { cookie: cookie(sessionToken) } : {}) });
async function account() {
  const invitation = await server.accounts.invitation();
  return server.accounts.register({ username: `u_${suffix()}`, displayName: 'Amigo ' + suffix(), password, invitation: invitation.code });
}
async function friendship() {
  const a = await account(), b = await account();
  await server.friends.request(a.user, b.user.username);
  const state = await server.friends.state(b.user, () => false);
  await server.friends.respond(b.user, state.incoming[0].id, true);
  const conversation = (await server.messages.list(a.user.id))[0];
  return { a, b, conversation };
}
async function connect(sessionToken: string) {
  const socket = io(base, { transports: ['websocket'], extraHeaders: headers(sessionToken), reconnection: false, forceNew: true, autoConnect: false });
  sockets.push(socket);
  socket.connect();
  await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([e]) => { throw e; }), wait(5000).then(() => { throw new Error('WebSocket no conectó'); })]);
  return socket;
}
before(async () => {
  const url = await prepareTestDatabase();
  server = await createApp({ DATABASE_URL: url, HOST: '127.0.0.1', PORT: 3000, APP_ORIGIN: origin, NODE_ENV: 'test', SESSION_DAYS: 7 });
  await server.db.migrate();
  base = await server.app.listen({ host: '127.0.0.1', port: 0 });
});
after(async () => { for (const socket of sockets) socket.disconnect(); await server?.app.close(); });

test('invitación: exactamente un registro gana una carrera de cinco solicitudes', async () => {
  const invitation = await server.accounts.invitation();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => server.accounts.register({ username: `u_${suffix()}`, displayName: 'Carrera', password, invitation: invitation.code })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const row = (await server.db.query('SELECT used_by,used_at FROM invitations WHERE used_by=$1', [(results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value.user.id])).rows[0];
  assert.ok(row.used_by); assert.ok(row.used_at);
});

test('registro inválido no consume invitación; vencimiento y nombre normalizado', async () => {
  const a = await account();
  const invitation = await server.accounts.invitation();
  await assert.rejects(server.accounts.register({ username: a.user.username.toUpperCase(), displayName: 'Otro', password, invitation: invitation.code }), /no está disponible/);
  const b = await server.accounts.register({ username: `UP_${suffix()}`, displayName: 'Válido', password, invitation: invitation.code });
  assert.equal(b.user.username, b.user.username.toLowerCase());
  const expired = await server.accounts.invitation(-1);
  await assert.rejects(server.accounts.register({ username: `u_${suffix()}`, displayName: 'Fuera de plazo', password, invitation: expired.code }), /venció/);
});

test('HTTP: cookie HttpOnly, origen comprobado, validación y cierre de sesión', async () => {
  const invite = await server.accounts.invitation();
  const registered = await server.app.inject({ method: 'POST', url: '/api/auth/register', headers: headers(), payload: { username: `u_${suffix()}`, displayName: 'HTTP', password, passwordConfirm:password, invitation: invite.code } });
  assert.equal(registered.statusCode, 201);
  assert.match(String(registered.headers['set-cookie']), /HttpOnly/);
  assert.match(String(registered.headers['set-cookie']), /SameSite=Strict/);
  assert.equal(registered.headers['cache-control'], 'no-store');
  const sessionCookie = String(registered.headers['set-cookie']).split(';')[0];
  assert.equal((await server.app.inject({ url: '/api/auth/me', headers: { cookie: sessionCookie } })).statusCode, 200);
  assert.equal((await server.app.inject({ url: '/api/social' })).statusCode, 401);
  assert.equal((await server.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.invalid', cookie: sessionCookie } })).statusCode, 403);
  assert.equal((await server.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin, cookie: sessionCookie } })).statusCode, 200);
  assert.equal((await server.app.inject({ url: '/api/auth/me', headers: { cookie: sessionCookie } })).statusCode, 401);
});

test('autenticación: límite de intentos y recuperación rota código y revoca sesiones', async () => {
  for (let i = 0; i < 8; i++) {
    const response = await server.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.5.1', headers: headers(), payload: { username: 'no_existe', password } });
    assert.equal(response.statusCode, 401);
  }
  assert.equal((await server.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.0.5.1', headers: headers(), payload: { username: 'no_existe', password } })).statusCode, 429);
  const a = await account();
  const second = await server.accounts.login({ username: a.user.username, password });
  const socket = await connect(a.sessionToken);
  const expired = once(socket, 'session:expired');
  const result = await server.app.inject({ method: 'POST', url: '/api/auth/recover', remoteAddress: '127.0.5.2', headers: headers(), payload: { username: a.user.username, code: a.recoveryCode, password: password + 'nuevo' } });
  assert.equal(result.statusCode, 200);
  await expired;
  await assert.rejects(server.accounts.identity(a.sessionToken));
  await assert.rejects(server.accounts.identity(second.sessionToken));
  assert.notEqual(result.json().recoveryCode, a.recoveryCode);
  await assert.rejects(server.accounts.recover({ username: a.user.username, code: a.recoveryCode, password }), /incorrectos/);
  await assert.rejects(server.accounts.login({ username: a.user.username, password }), /incorrectos/);
});

test('amistad: solo destinatario acepta; eliminar y desbloquear no restauran amistad', async () => {
  const a = await account(), b = await account();
  await server.friends.request(a.user, b.user.username);
  const state = await server.friends.state(b.user, () => false);
  await assert.rejects(server.friends.respond(a.user, state.incoming[0].id, true));
  await server.friends.respond(b.user, state.incoming[0].id, true);
  assert.equal((await server.friends.state(a.user, () => false)).friends.length, 1);
  await server.friends.change(a.user, b.user.id, 'remove');
  assert.equal((await server.messages.list(a.user.id))[0].canSend, false);
  await server.friends.change(a.user, b.user.id, 'block');
  await assert.rejects(server.friends.request(b.user, a.user.username));
  await server.friends.change(a.user, b.user.id, 'unblock');
  assert.equal((await server.friends.state(a.user, () => false)).friends.length, 0);
  assert.equal((await server.messages.list(a.user.id))[0].canSend, false);
});

test('mensajes: reintentos concurrentes guardan una sola copia y un solo orden', async () => {
  const { a, conversation } = await friendship();
  const input = { conversationId: conversation.id, clientId: randomUUID(), text: 'Un único mensaje' };
  const results = await Promise.all(Array.from({ length: 8 }, () => server.messages.send(a.sessionToken, input)));
  assert.equal(new Set(results.map(r => r.message.id)).size, 1);
  assert.equal(results[0].message.seq, 1);
  assert.equal((await server.messages.history(a.user.id, conversation.id, { limit: 50 })).messages.length, 1);
  await assert.rejects(server.messages.send(a.sessionToken, { ...input, text: 'Otro contenido' }), /identificador/);
});

test('permisos: tercero no consulta historial, envía ni recibe eventos privados', async () => {
  const { a, b, conversation } = await friendship();
  const stranger = await account();
  const aSocket = await connect(a.sessionToken), bSocket = await connect(b.sessionToken), strangerSocket = await connect(stranger.sessionToken);
  let leaked = 0;
  strangerSocket.on('message:new', () => leaked++);
  strangerSocket.emit('join', conversation.id);
  assert.equal((await server.app.inject({ url: `/api/conversations/${conversation.id}/messages`, headers: headers(stranger.sessionToken) })).statusCode, 403);
  const forged = await strangerSocket.timeout(3000).emitWithAck('message:send', { conversationId: conversation.id, clientId: randomUUID(), text: 'Intruso', senderId: a.user.id });
  assert.equal(forged.ok, false);
  const incoming = once(bSocket, 'message:new');
  const result = await aSocket.timeout(3000).emitWithAck('message:send', { conversationId: conversation.id, clientId: randomUUID(), text: 'Mensaje privado', senderId: stranger.user.id });
  assert.equal(result.ok, true);
  assert.equal(result.message.senderId, a.user.id);
  assert.equal((await incoming)[0].text, 'Mensaje privado');
  await wait(150);
  assert.equal(leaked, 0);
});

test('bloqueo: sockets abiertos pierden permiso; historial permanece y presencia se oculta', async () => {
  const { a, b, conversation } = await friendship();
  const aSocket = await connect(a.sessionToken), bSocket = await connect(b.sessionToken);
  await server.messages.send(a.sessionToken, { conversationId: conversation.id, clientId: randomUUID(), text: 'Antes del bloqueo' });
  const result = await server.app.inject({ method: 'POST', url: `/api/friends/${b.user.id}/block`, headers: headers(a.sessionToken) });
  assert.equal(result.statusCode, 200);
  assert.equal((await server.friends.state(b.user, server.presence.isOnline)).friends.length, 0);
  assert.equal((await server.friends.state(a.user, server.presence.isOnline)).blocked[0].id, b.user.id);
  const payload = { conversationId: conversation.id, clientId: randomUUID(), text: 'No debe pasar' };
  assert.equal((await aSocket.timeout(3000).emitWithAck('message:send', payload)).ok, false);
  assert.equal((await bSocket.timeout(3000).emitWithAck('message:send', payload)).ok, false);
  const history = await server.messages.history(b.user.id, conversation.id, { limit: 50 });
  assert.equal(history.messages.length, 1);
});

test('desconexión: destinatario recupera mensajes pendientes con cursor y paginación', async () => {
  const { a, b, conversation } = await friendship();
  for (let i = 1; i <= 7; i++) await server.messages.send(a.sessionToken, { conversationId: conversation.id, clientId: randomUUID(), text: `Mensaje ${i}` });
  const page1 = await server.messages.history(b.user.id, conversation.id, { after: 0, limit: 3 });
  assert.deepEqual(page1.messages.map(m => m.seq), [1, 2, 3]); assert.equal(page1.hasMore, true);
  const page2 = await server.messages.history(b.user.id, conversation.id, { after: 3, limit: 100 });
  assert.deepEqual(page2.messages.map(m => m.seq), [4, 5, 6, 7]); assert.equal(page2.hasMore, false);
  const latest = await server.messages.history(b.user.id, conversation.id, { limit: 3 });
  assert.deepEqual(latest.messages.map(m => m.seq), [5, 6, 7]);
  const older = await server.messages.history(b.user.id, conversation.id, { before: 5, limit: 3 });
  assert.deepEqual(older.messages.map(m => m.seq), [2, 3, 4]);
});

test('presencia: cerrar una de dos pestañas conserva conexión; última se desconecta', async () => {
  const a = await account();
  const tab1 = await connect(a.sessionToken), tab2 = await connect(a.sessionToken);
  assert.equal(server.presence.isOnline(a.user.id), true);
  tab1.disconnect(); await wait(100);
  assert.equal(server.presence.isOnline(a.user.id), true);
  tab2.disconnect(); await wait(3300);
  assert.equal(server.presence.isOnline(a.user.id), false);
});

test('persistencia: reiniciar el servidor conserva sesión, amigos y mensajes', async () => {
  const { a, b, conversation } = await friendship();
  await server.messages.send(a.sessionToken, { conversationId: conversation.id, clientId: randomUUID(), text: 'Sobrevive al reinicio' });
  const config = server.config;
  for (const socket of sockets) socket.disconnect();
  await server.app.close();
  server = await createApp(config);
  await server.db.migrate();
  assert.equal((await server.accounts.identity(a.sessionToken)).user.id, a.user.id);
  assert.equal((await server.friends.state(a.user, () => false)).friends[0].id, b.user.id);
  assert.equal((await server.messages.history(a.user.id, conversation.id, { limit: 50 })).messages[0].text, 'Sobrevive al reinicio');
});


test('registro abierto: sin invitación, confirmación obligatoria y contraseña de ocho caracteres', async () => {
 const body={username:`u_${suffix()}`,displayName:'Cuenta abierta',password:'abcdef12'};
 const post=(payload:unknown)=>server.app.inject({method:'POST',url:'/api/auth/register',remoteAddress:'127.0.20.4',headers:headers(),payload});
 assert.equal((await post(body)).statusCode,400);
 assert.equal((await post({...body,passwordConfirm:'diferente'})).statusCode,400);
 const result=await post({...body,passwordConfirm:body.password});
 assert.equal(result.statusCode,201);assert.equal(result.json().recoveryCode,undefined);
 const login=await server.accounts.login({username:body.username,password:body.password});assert.equal(login.user.username,body.username);
});
