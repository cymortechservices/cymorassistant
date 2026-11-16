import { getConfig } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './database/connect.js';
import { seedSettings } from './services/settings.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

/** Heroku `web` process: dashboard + admin API. It never opens a WhatsApp connection. */
async function main() {
  const config = getConfig();
  await connectDatabase(config.MONGODB_URI);
  await seedSettings(config);
  const app = createApp({ config });
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'Web server listening'));

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down web process');
    server.close(async () => {
      await disconnectDatabase().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error({ err: e.message }, 'Web process failed to start');
  process.exit(1);
});
