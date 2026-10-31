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
  handleWebhookEvent(req: Request, res: Response, next: NextFunction): void {
    // 1. Instantly return 200 OK to Meta so it never triggers retry attempts
    res.status(200).send('EVENT_RECEIVED');

    // 2. Offload event handling to background so HTTP socket is immediately closed
    setImmediate(async () => {
      try {
        await webhookService.processWebhookEvent(req.body);
      } catch (error) {
        logger.error('Error processing webhook event in background', error);
      }
    });
  }
}

export const webhookController = new WebhookController();
