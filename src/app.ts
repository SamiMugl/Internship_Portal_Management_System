/**
 * Express application factory
 *
 * Creates and configures the Express app instance.  Separated from the
 * server entry-point so the app can be imported directly in tests without
 * starting a network listener.
 */

import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import apiRouter from './routes/index';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): express.Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS
  app.use(cors());

  // Request logging
  app.use(morgan('dev'));

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve uploaded files (resumes, logos)
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // API routes
  app.use('/api/v1', apiRouter);

  // 404 handler — must come after all routes
  app.use(notFound);

  // Global error handler — must be last
  app.use(errorHandler);

  return app;
}
