import { createApp } from '../apps/server/src/app.js';
import { prepareTestDatabase } from '../apps/server/test/database.js';
import { createGameFixture } from './game-fixture.js';

const server = await createApp({ DATABASE_URL: await prepareTestDatabase(), APP_ORIGIN: 'http://127.0.0.1:4300', HOST: '127.0.0.1', PORT: 4300, NODE_ENV: 'test', SESSION_DAYS: 7, CRASH_HOST_USERNAME: 'e2e_game_host', CRASH_PROJECT_DIR: await createGameFixture() });
await server.db.migrate();
await server.app.listen({ host: '127.0.0.1', port: 4300 });
console.log('Servidor de pruebas NSM listo.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.app.close().then(() => process.exit(0)); });
