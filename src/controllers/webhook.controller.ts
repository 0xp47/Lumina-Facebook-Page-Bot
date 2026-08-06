import { Request, Response, NextFunction } from 'express';
import { webhookService } from '../services/webhook.service';

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
      // Must respond with 200 OK immediately so Meta doesn't retry
      res.status(200).send('EVENT_RECEIVED');
      await webhookService.processWebhookEvent(req.body);
    } catch (error) {
      next(error);
    }
  }
}

export const webhookController = new WebhookController();
