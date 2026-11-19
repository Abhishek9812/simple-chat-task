import type { Server } from 'node:http';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createLogger } from './config/logger';
import { buildContainer } from './container';
import { createFirestore } from './db/firestore';
import { createPool } from './db/postgres';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL,
  });
  pool.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));

  const firestore = createFirestore({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
    emulatorHost: env.FIRESTORE_EMULATOR_HOST,
  });

  const app = createApp(buildContainer({ pool, firestore, logger, corsOrigin: env.CORS_ORIGIN }));

  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Chat service listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close(() => {
      Promise.allSettled([pool.end(), firestore.terminate()])
        .then(() => {
          logger.info('Shutdown complete');
          process.exit(0);
        })
        .catch(() => process.exit(1));
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
}

main();
