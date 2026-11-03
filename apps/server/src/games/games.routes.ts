import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idSchema } from '../../../../packages/contracts/src/index.js';
import type { Identity } from '../accounts/accounts.service.js';
import { AppError, forbidden } from '../errors.js';
import type { GamesService } from './games.service.js';

export async function registerGameRoutes(app: FastifyInstance, games: GamesService, identity: (request: FastifyRequest) => Promise<Identity>) {
  app.post('/api/games/rooms', { config: { rateLimit: { max:12, timeWindow:'1 minute' } } }, async request => {
    const { gameId } = z.object({gameId:z.string().min(1).max(64)}).parse(request.body);
    return games.create((await identity(request)).user, gameId);
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
  app.get('/api/games/rooms/:id/media/:file', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id, file } = z.object({ id: idSchema, file: z.enum(['game.chd', 'bios.bin', 'loader.js', 'game.sbi']) }).parse(request.params);
    const { room, member } = await games.authorize((await identity(request)).user, id);
    if (member.seat !== 0) throw forbidden();
    const files = await games.files(room.gameId);
    if (!files) throw new AppError(503, 'No se encuentran los archivos del juego.');
    const path = file === 'game.chd' ? files.game : file === 'bios.bin' ? files.bios : file === 'game.sbi' ? files.sbi : files.loader;
    if (!path) throw new AppError(404, 'No se configuraron los datos complementarios del disco.');
    const info = await stat(path);
    reply.header('Content-Length', info.size).type(file === 'loader.js' ? 'text/javascript' : 'application/octet-stream');
    return reply.send(createReadStream(path));
  });
}
