/// <reference path="./types/express.d.ts" />
import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { rawBodySaver } from './middlewares/rawBody.middleware';
import { errorHandler } from './middlewares/errorHandler.middleware';
import pageRoutes from './routes/page.routes';
import webhookRoutes from './routes/webhook.routes';
import botRoutes from './routes/bot.routes';
import { logger } from './utils/logger';

const app: Application = express();

// Global Middlewares
app.use(cors());

// Configure JSON body parser with rawBodySaver to retain raw Buffer for HMAC SHA-256 verification
app.use(
  express.json({
    verify: rawBodySaver
  })
);
app.use(express.urlencoded({ extended: true }));

// Request Logging Middleware
app.use((req: Request, _res: Response, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Register Module Routes
app.use('/webhook', webhookRoutes);
app.use('/api/page', pageRoutes);
app.use('/api/bot', botRoutes);

// Global Error Handler Middleware
app.use(errorHandler);

export default app;
