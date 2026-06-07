/**
 * HTTP server entry-point
 *
 * Binds the Express application to the configured PORT and handles
 * graceful shutdown on SIGTERM / SIGINT.
 */

import http from 'http';
import { env } from './config/env';
import { getPublicAppUrl, getPublicFrontendUrl, initMailTransport } from './config/mailTransport';
import { createApp } from './app';
import { registerDeadlineCron, deadlineCronQueue } from './queues/deadlineCron';
import { registerEmailWorker } from './queues/emailWorker';
import { emailQueue } from './queues/emailQueue';

let server: http.Server;

async function start(): Promise<void> {
  await initMailTransport();

  const app = createApp();

  server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    console.log(`📧 Email links: ${getPublicAppUrl()}`);
    console.log(`🌐 Frontend (mobile): ${getPublicFrontendUrl()}`);
    registerEmailWorker();
    registerDeadlineCron().catch((err) => {
      console.error('[server] Failed to register deadline cron job:', err);
    });
  });
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  if (!server) {
    process.exit(0);
    return;
  }

  server.close(() => {
    console.log('HTTP server closed.');
    Promise.all([emailQueue.close(), deadlineCronQueue.close()]).finally(() => {
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
