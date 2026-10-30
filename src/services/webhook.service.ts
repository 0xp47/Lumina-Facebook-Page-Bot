import { env } from '../config/env.config';
import { WebhookPayload, WebhookVerificationQuery } from '../types/webhook.types';
import { botService } from './bot.service';
import { logger } from '../utils/logger';
import { AppError } from '../middlewares/errorHandler.middleware';

export class WebhookService {
  /**
   * Handle Webhook Verification GET Request
   * Meta sends hub.mode, hub.verify_token, and hub.challenge
   */
  verifyWebhook(query: WebhookVerificationQuery): string {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === env.facebook.verifyToken) {
        logger.info('Webhook challenge verified successfully!');
        return challenge || '';
      } else {
        logger.error('Webhook token mismatch during verification challenge.');
        throw new AppError(403, 'Webhook verification failed: token mismatch');
      }
    }

    throw new AppError(400, 'Invalid webhook verification query parameters');
  }

  /**
   * Handle Webhook POST Event Payload
   */
  async processWebhookEvent(body: WebhookPayload): Promise<void> {
    if (body.object !== 'page') {
      logger.warn(`Received non-page webhook object: ${body.object}`);
      return;
    }

    for (const entry of body.entry) {
      // 1. Process Page Messenger events
      if (entry.messaging && Array.isArray(entry.messaging)) {
        for (const messagingEvent of entry.messaging) {
          const senderPsid = messagingEvent.sender.id;

          // Ignore echo messages sent by the Page to prevent infinite reply loops
          if (messagingEvent.message && !messagingEvent.message.is_echo) {
            await botService.handleIncomingMessage(senderPsid, messagingEvent.message.text);
          }

          // Handle postback events (e.g. Get Started button or Persistent Menu taps)
          if (messagingEvent.postback) {
            const payload = messagingEvent.postback.payload || messagingEvent.postback.title;
            const textToProcess = payload === 'GET_STARTED' ? 'help' : payload;
            await botService.handleIncomingMessage(senderPsid, textToProcess);
          }
        }
      }

      // 2. Process Page Feed / Comment events
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'feed') {
            const feedValue = change.value;
            // Ignore comments made by the Page itself to prevent self-reply loops
            if (
              feedValue.item === 'comment' &&
              feedValue.verb === 'add' &&
              feedValue.sender_id !== env.facebook.pageId
            ) {
              await botService.handleIncomingComment(
                feedValue.comment_id,
                feedValue.sender_id,
                feedValue.message
              );
            }
          }
        }
      }
    }
  }
}

export const webhookService = new WebhookService();
