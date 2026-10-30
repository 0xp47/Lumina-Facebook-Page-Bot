import { Request, Response, NextFunction } from 'express';
import { webhookService } from '../services/webhook.service';
import { logger } from '../utils/logger';

export class WebhookController {
  /**
   * GET /webhook
   * Verification challenge endpoint for Facebook App Dashboard
   */
  verifyWebhook(req: Request, res: Response, next: NextFunction): void {
    try {
      const challenge = webhookService.verifyWebhook(req.query);
      res.status(200).send(challenge);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /webhook
   * Handles incoming Facebook event notifications
   */
  async handleWebhookEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Respond with 200 OK immediately so Meta doesn't retry
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      return next(error);
    }

    // Process event asynchronously after response is closed
    try {
      await webhookService.processWebhookEvent(req.body);
    } catch (error) {
      logger.error('Error processing webhook event in background', error);
    }
  }
}

export const webhookController = new WebhookController();
