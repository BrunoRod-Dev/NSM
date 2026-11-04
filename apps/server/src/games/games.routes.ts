import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idSchema } from '../../../../packages/contracts/src/index.js';
import type { Identity } from '../accounts/accounts.service.js';
import { AppError, forbidden } from '../errors.js';
import type { GamesService } from './games.service.js';

const digests = new Map<string, { sha256: string; chunks: string[] }>();

export async function registerGameRoutes(app: FastifyInstance, games: GamesService, identity: (request: FastifyRequest) => Promise<Identity>) {
  app.post('/api/games/rooms', { config: { rateLimit: { max:12, timeWindow:'1 minute' } } }, async request => {
    const { gameId } = z.object({gameId:z.string().min(1).max(64)}).parse(request.body);
    return games.create((await identity(request)).user, gameId);
  });
  app.get('/api/games/library/:gameId', async (request) => {
    await identity(request);
    const { gameId } = z.object({ gameId: z.string().max(64) }).parse(request.params);
    const files = await games.files(gameId);
    if (!files) throw new AppError(503, 'Este juego no está disponible.');
    const assets = [];
    for (const [name, path] of [['game.chd', files.game], ['bios.bin', files.bios], ['game.sbi', files.sbi]] as const) {
      if (!path) continue;
      const info = await stat(path);
      const key = path + ':' + info.size + ':' + info.mtimeMs;
      let digest = digests.get(key);
      if (!digest) {
        const hash = createHash('sha256'), chunks = [];
        const handle = await open(path, 'r');
        try {
          for (let offset = 0; offset < info.size; offset += 8 * 1024 * 1024) {
            const bytes = Buffer.alloc(Math.min(8 * 1024 * 1024, info.size - offset));
            let filled = 0;
            while (filled < bytes.length) {
              const result = await handle.read(bytes, filled, bytes.length - filled, offset + filled);
              if (!result.bytesRead) throw new Error('El archivo cambió durante la verificación.');
              filled += result.bytesRead;
            }
            hash.update(bytes); chunks.push(createHash('sha256').update(bytes).digest('hex'));
          }
        } finally { await handle.close(); }
        digest = { sha256: hash.digest('hex'), chunks }; digests.set(key, digest);
      }
      assets.push({ name, scope: name === 'bios.bin' ? 'console-' + games.catalog.definition(gameId).console : gameId, size: info.size, sha256: digest.sha256, chunks: digest.chunks, url: '/api/games/library/' + gameId + '/media/' + name });
    }
    return { gameId, assets };
  });
  app.get('/api/games', async request => games.state((await identity(request)).user));
  app.post('/api/games/invitations', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async request => {
    const { targetId, gameId } = z.object({ targetId: idSchema, gameId: z.string().min(1).max(64) }).parse(request.body);
    return games.invite((await identity(request)).user, targetId, gameId);
  });
  app.post('/api/games/crash/invitations', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async request => {
    const { targetId } = z.object({ targetId: idSchema }).parse(request.body);
    return games.invite((await identity(request)).user, targetId);
  });
  app.post('/api/games/invitations/:id', async request => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
    return games.respond((await identity(request)).user, id, accept);
  });
  app.get('/api/games/rooms/:id/player', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async request => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    return games.player((await identity(request)).user, id);
  });
  app.post('/api/games/rooms/:id/engine/:action', { bodyLimit: 32768, config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async request => {
    const { id, action } = z.object({ id: idSchema, action: z.enum(['host-reset', 'heartbeat', 'ready', 'poll', 'resume', 'signal']) }).parse(request.params);
    const body = z.record(z.string(), z.unknown()).parse(request.body ?? {});
    return games.engine((await identity(request)).user, id, action, body);
  });
  app.post('/api/games/rooms/:id/leave', async request => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    const { user } = await identity(request);
    await games.authorize(user, id);
    games.leave(user.id, id);
    return { ok: true };
  });
  app.get('/api/games/rooms/:id/view', async (request, reply) => {
    const { id } = z.object({ id: idSchema }).parse(request.params);
    await games.authorize((await identity(request)).user, id);
    // EmulatorJS needs dynamic compilation. This policy is restricted to the game frame.
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' blob: 'unsafe-inline' 'unsafe-eval' https://cdn.emulatorjs.org; style-src 'self' 'unsafe-inline' https://cdn.emulatorjs.org; connect-src 'self' blob: https://cdn.emulatorjs.org; img-src 'self' data: blob: https://cdn.emulatorjs.org; media-src 'self' blob:; worker-src 'self' blob:; font-src 'self' data: https://cdn.emulatorjs.org; frame-ancestors 'self'; object-src 'none'");
    return reply.type('text/html; charset=utf-8').send(await readFile(resolve('apps/web/public/crash/player.html'), 'utf8'));
  });
  for (const url of ['/api/games/rooms/:id/media/:file', '/api/games/library/:gameId/media/:file']) app.get(url, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id, gameId, file } = z.object({ id: idSchema.optional(), gameId: z.string().max(64).optional(), file: z.enum(['game.chd', 'bios.bin', 'loader.js', 'game.sbi', 'mslug.zip', 'mslug2.zip', 'mslugx.zip', 'mslug3.zip', 'mslug4.zip', 'mslug5.zip', 'neogeo.zip']) }).parse(request.params);
    const auth = await identity(request);
    let selected = gameId;
    if (id) {
      const { room, member } = await games.authorize(auth.user, id);
      if (member.seat !== 0) throw forbidden();
      selected = room.gameId;
    }
    if (!selected) throw forbidden();
    const files = await games.files(selected);
    if (!files) throw new AppError(503, 'No se encuentran los archivos del juego.');
    if (file.endsWith('.zip') && files.game.split(/[\\/]/).pop() !== file && file !== 'neogeo.zip') throw forbidden();
    const path = file === 'neogeo.zip' ? files.bios : file.endsWith('.zip') ? files.game : file === 'game.chd' ? files.game : file === 'bios.bin' ? files.bios : file === 'game.sbi' ? files.sbi : files.loader;
    if (!path) throw new AppError(404, 'No se configuraron los datos complementarios del disco.');
    const info = await stat(path);
    if (file !== 'loader.js') {
      const version = '"' + info.size + '-' + Math.trunc(info.mtimeMs) + '"';
      reply.header('Accept-Ranges', 'bytes').header('ETag', version);
      const range = request.headers.range;
      if (range && (!request.headers['if-range'] || request.headers['if-range'] === version)) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1] ? Number(match[1]) : Math.max(0, info.size - Number(match?.[2]));
        const end = match?.[1] && match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1;
        if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || start > end) {
          return reply.code(416).header('Content-Range', 'bytes */' + info.size).send();
        }
        return reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`)
          .header('Content-Length', end - start + 1).type('application/octet-stream').send(createReadStream(path, { start, end }));
      }
    }
    reply.header('Content-Length', info.size).type(file === 'loader.js' ? 'text/javascript' : 'application/octet-stream');
    return reply.send(createReadStream(path));
  });
}
