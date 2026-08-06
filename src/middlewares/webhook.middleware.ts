import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.config';
import { verifySignature } from '../utils/crypto';
import { logger } from '../utils/logger';

export function validateWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If app secret is not configured, warn and skip signature verification in development mode
  if (!env.facebook.appSecret || env.facebook.appSecret === 'your_app_secret_here') {
    logger.warn('FACEBOOK_APP_SECRET is not set. Skipping webhook signature verification.');
    return next();
  }

  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    logger.error('Webhook payload missing x-hub-signature-256 header.');
    res.status(401).json({ error: 'Missing x-hub-signature-256 header' });
    return;
  }

  if (!req.rawBody) {
    logger.error('Raw body buffer missing on webhook request.');
    res.status(400).json({ error: 'Raw body buffer missing' });
    return;
  }

  const isValid = verifySignature(req.rawBody, signature, env.facebook.appSecret);

  if (!isValid) {
    logger.error('Invalid webhook signature verification failed.');
    res.status(403).json({ error: 'Invalid signature verification' });
    return;
  }

  logger.info('Webhook signature verified successfully.');
  next();
}
