import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prepareTestDatabase } from './database.js';
import { createGameFixture } from '../../../scripts/game-fixture.js';

let server: Awaited<ReturnType<typeof createApp>>;
const origin = 'http://localhost:4200', password = 'Una contraseña segura 2000!';
type Account = Awaited<ReturnType<typeof server.accounts.register>>;
const headers = (a: Account) => ({ origin, cookie: `nsm.sid=${a.sessionToken}` });
async function account() { return server.accounts.register({ username: 'g_' + randomUUID().replaceAll('-', '').slice(0, 12), displayName: 'Jugador', password, invitation: (await server.accounts.invitation()).code }); }
async function friend(a: Account, b: Account) { await server.friends.request(a.user, b.user.username); const social = await server.friends.state(b.user, () => false); await server.friends.respond(b.user, social.incoming[0].id, true); }
async function setup() { const host = await account(), guest = await account(); server.config.CRASH_HOST_USERNAME = host.user.username; await friend(host, guest); const { room } = await server.games.invite(host.user, guest.user.id); return { host, guest, room }; }
before(async () => {
  server = await createApp({ DATABASE_URL: await prepareTestDatabase(), HOST: '127.0.0.1', PORT: 4300, APP_ORIGIN: origin, NODE_ENV: 'test', SESSION_DAYS: 7, CRASH_PROJECT_DIR: await createGameFixture(), CRASH_HOST_USERNAME: '' });
  await server.db.migrate(); await server.app.ready();
});
after(async () => { await server?.app.close(); });

test('juegos: invitaciones solo entre amigos; destinatario autenticado y archivos solo anfitrión', async () => {
  const { host, guest, room } = await setup(), stranger = await account();
  await assert.rejects(server.games.invite(host.user, stranger.user.id));
  await assert.rejects(server.games.invite(guest.user, host.user.id));
  const invite = (await server.games.state(guest.user)).incoming[0];
  await assert.rejects(server.games.respond(stranger.user, invite.id, true));
  await server.games.respond(guest.user, invite.id, true);
  assert.equal((await server.games.player(guest.user, room.id)).seat, 1);
  const url = `/api/games/rooms/${room.id}`;
  assert.equal((await server.app.inject({ url: url + '/view' })).statusCode, 401);
  assert.equal((await server.app.inject({ url: url + '/view', headers: headers(stranger) })).statusCode, 403);
  assert.equal((await server.app.inject({ url: url + '/media/game.chd', headers: headers(guest) })).statusCode, 403);
  assert.equal((await server.app.inject({ url: url + '/media/bios.bin', headers: headers(guest) })).statusCode, 403);
  assert.equal((await server.app.inject({ url: url + '/media/game.sbi', headers: headers(guest) })).statusCode, 403);
  assert.equal((await server.app.inject({ url: url + '/media/loader.js', headers: headers(guest) })).statusCode, 403);
  const media = await server.app.inject({ url: url + '/media/game.chd', headers: headers(host) });
  assert.equal(media.statusCode, 200); assert.match(media.body, /TEST FIXTURE/);
  const frame = await server.app.inject({ url: url + '/view', headers: headers(host) });
  assert.equal(frame.statusCode, 200); assert.match(String(frame.headers['content-security-policy']), /frame-ancestors 'self'/);
  const state = await server.app.inject({ url: '/api/games', headers: headers(stranger) });
  assert.equal(state.json().rooms.length, 0); assert.equal(state.json().incoming.length, 0);
});

test('juegos: cuatro plazas exclusivas, reservas y aceptación simultánea sin duplicados', async () => {
  const host = await account(); server.config.CRASH_HOST_USERNAME = host.user.username;
  const guests = await Promise.all(Array.from({ length: 4 }, () => account()));
  for (const guest of guests) await friend(host, guest);
  const rooms = await Promise.all(guests.slice(0, 3).map(guest => server.games.invite(host.user, guest.user.id)));
  assert.equal(new Set(rooms.map(r => r.room.id)).size, 1);
  await assert.rejects(server.games.invite(host.user, guests[3].user.id), /cuatro plazas/);
  const first = (await server.games.state(guests[0].user)).incoming[0];
  const race = await Promise.allSettled(Array.from({ length: 3 }, () => server.games.respond(guests[0].user, first.id, true)));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  for (const guest of guests.slice(1, 3)) await server.games.respond(guest.user, (await server.games.state(guest.user)).incoming[0].id, true);
  const room = (await server.games.state(host.user)).rooms[0];
  assert.deepEqual(room.players.map(p => p.seat), [0, 1, 2, 3]);
  for (const guest of guests) server.games.leaveUser(guest.user.id);
  server.games.leaveUser(host.user.id);
});

test('juegos: señalización no permite falsificar remitente, usar otra sala ni ofrecer desde invitado', async () => {
  const { host, guest, room } = await setup();
  await server.games.respond(guest.user, (await server.games.state(guest.user)).incoming[0].id, true);
  const clientId = randomUUID();
  await server.games.engine(host.user, room.id, 'host-reset', { clientId });
  await assert.rejects(server.games.engine(guest.user, room.id, 'signal', { to: 0, data: { type: 'offer', description: { type: 'offer', sdp: 'bad' } } }));
  await server.games.engine(guest.user, room.id, 'signal', { to: 0, from: 3, data: { type: 'answer', from: 3, description: { type: 'answer', sdp: 'test' } } });
  const poll = await server.games.engine(host.user, room.id, 'poll', { clientId, ack: 0 }) as any;
  assert.equal(poll.events.find((e: any) => e.type === 'answer').from, 1);
  assert.deepEqual(await server.games.engine(host.user, room.id, 'poll', { clientId, ack: 0 }), poll);
  await server.games.engine(host.user, room.id, 'host-reset', { clientId: randomUUID() });
  await assert.rejects(server.games.engine(host.user, room.id, 'heartbeat', { clientId }), /otra ventana/);
  server.games.leaveUser(host.user.id);
  await assert.rejects(server.games.player(guest.user, room.id));
});

test('juegos: bloqueo revoca invitaciones y cierra partida; cerrar sesión libera la plaza', async () => {
  const { host, guest, room } = await setup();
  await server.games.respond(guest.user, (await server.games.state(guest.user)).incoming[0].id, true);
  const blocked = await server.app.inject({ method: 'POST', url: `/api/friends/${guest.user.id}/block`, headers: headers(host) });
  assert.equal(blocked.statusCode, 200); assert.equal((await server.games.state(guest.user)).rooms.length, 0);
  await assert.rejects(server.games.player(guest.user, room.id));
  const second = await setup();
  await server.games.respond(second.guest.user, (await server.games.state(second.guest.user)).incoming[0].id, true);
  await server.app.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(second.guest) });
  assert.equal((await server.games.state(second.host.user)).rooms[0].players.length, 1);
});


test('catálogo: rechaza identificadores desconocidos, deshabilitados y archivos ausentes; conserva juego al aceptar', async () => {
  const {host,guest,room} = await setup();
  for (const gameId of ['../secrets', 'unknown', 'crash-team-racing']) {
    const response = await server.app.inject({method:'POST',url:'/api/games/invitations',headers:headers(host),payload:{targetId:guest.user.id,gameId}});
    assert.ok([404,503].includes(response.statusCode));
  }
  const saved = server.config.CRASH_PROJECT_DIR;
  try {
    server.config.CRASH_PROJECT_DIR = undefined;
    const response = await server.app.inject({method:'POST',url:'/api/games/invitations',headers:headers(host),payload:{targetId:guest.user.id,gameId:'crash-bash'}});
    assert.equal(response.statusCode,503);
  } finally {server.config.CRASH_PROJECT_DIR = saved;}
  const response = await server.app.inject({method:'POST',url:'/api/games/invitations',headers:headers(host),payload:{targetId:guest.user.id,gameId:'crash-bash'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().room.gameId,'crash-bash');
  const invitation=(await server.games.state(guest.user)).incoming[0];
  assert.equal(invitation.gameId,'crash-bash');
  const accepted=await server.games.respond(guest.user,invitation.id,true);
  assert.equal(accepted.room?.gameId,'crash-bash');
  assert.equal((await server.games.player(guest.user,room.id)).game.name,'Crash Bash');
  const catalog=(await server.games.state(host.user)).catalog;
  assert.equal(catalog.find(g=>g.id==='crash-team-racing')?.available,false);
  server.games.leaveUser(host.user.id);
});


test('CTR: sala e invitación conservan el título y medios quedan restringidos al anfitrión', async () => {
  const {host,guest} = await setup();
  server.games.leaveUser(host.user.id);
  const files = await server.games.files('crash-bash');
  const {writeFile} = await import('node:fs/promises');
  const {resolve} = await import('node:path');
  const sbi=resolve('.local/crash-test/test.sbi');
  await writeFile(sbi, Buffer.from([83,66,73,0]));
  server.config.CTR_GAME_PATH=files!.game; server.config.CTR_SBI_PATH=sbi;
  try {
    const created=await server.app.inject({method:'POST',url:'/api/games/invitations',headers:headers(host),payload:{targetId:guest.user.id,gameId:'crash-team-racing'}});
    assert.equal(created.statusCode,200);
    const invitation=(await server.games.state(guest.user)).incoming[0];
    assert.equal(invitation.gameId,'crash-team-racing');
    const accepted=await server.games.respond(guest.user,invitation.id,true);
    assert.equal(accepted.room?.gameId,'crash-team-racing');
    const base='/api/games/rooms/'+accepted.room!.id;
    const player=await server.games.player(host.user,accepted.room!.id);
    assert.equal(player.game.name,'Crash Team Racing'); assert.equal(player.hasSbi,true);
    assert.equal((await server.app.inject({url:base+'/media/game.sbi',headers:headers(host)})).statusCode,200);
    assert.equal((await server.app.inject({url:base+'/media/game.chd',headers:headers(guest)})).statusCode,403);
    assert.equal((await server.app.inject({url:base+'/media/game.sbi',headers:headers(guest)})).statusCode,403);
  } finally {server.games.leaveUser(host.user.id);server.config.CTR_GAME_PATH=undefined;server.config.CTR_SBI_PATH=undefined;}
});


test('salas: crear sin chat es idempotente, valida juego y permisos, permite invitar después', async () => {
  const host=await account(),guest=await account();server.config.CRASH_HOST_USERNAME=host.user.username;
  const create=(a:Account,gameId='crash-bash')=>server.app.inject({method:'POST',url:'/api/games/rooms',headers:headers(a),payload:{gameId}});
  assert.equal((await create(guest)).statusCode,200);
  server.games.leaveUser(guest.user.id);
  assert.equal((await create(host,'invalid')).statusCode,404);
  const results=await Promise.all([create(host),create(host)]);
  assert.equal(results[0].statusCode,200);assert.equal(results[1].statusCode,200);
  const room=results[0].json().room;
  assert.equal(room.id,results[1].json().room.id);assert.equal(room.players.length,1);
  assert.equal((await server.games.state(guest.user)).rooms.length,0);
  await friend(host,guest);const invited=await server.games.invite(host.user,guest.user.id);
  assert.equal(invited.room.id,room.id);
  await server.games.respond(guest.user,(await server.games.state(guest.user)).incoming[0].id,true);
  assert.equal((await server.games.player(guest.user,room.id)).seat,1);
  server.games.leaveUser(host.user.id);
});
