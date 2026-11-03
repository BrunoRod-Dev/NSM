import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const { app, db } = await createApp(config, { logger: true });
try {
  await db.migrate();
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(`NSM disponible en http://${config.HOST}:${config.PORT}`);
} catch (error) {
  app.log.error({ code: (error as { code?: string }).code ?? 'STARTUP_ERROR' }, 'No se pudo iniciar NSM. Revisá PostgreSQL, el puerto y la configuración.');
  await app.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
