import { env } from '../config/env.config';
import { WebhookPayload, WebhookVerificationQuery } from '../types/webhook.types';
import { botService } from './bot.service';
import { logger } from '../utils/logger';
import { AppError } from '../middlewares/errorHandler.middleware';

export class WebhookService {
  /** In-memory cache to prevent duplicate processing of Meta webhooks (mid -> timestamp) */
  private processedMids = new Map<string, number>();
  /** User prompt deduplication window (psid:text -> timestamp) */
  private recentPrompts = new Map<string, number>();

  private pruneCaches(): void {
    const now = Date.now();
    const TEN_MINS = 10 * 60 * 1000;
    for (const [mid, time] of this.processedMids.entries()) {
      if (now - time > TEN_MINS) {
        this.processedMids.delete(mid);
      }
    }
    for (const [key, time] of this.recentPrompts.entries()) {
      if (now - time > 15000) {
        this.recentPrompts.delete(key);
      }
    }
  }

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

    this.pruneCaches();

    for (const entry of body.entry) {
      // 1. Process Page Messenger events concurrently
      if (entry.messaging && Array.isArray(entry.messaging)) {
        await Promise.allSettled(
          entry.messaging.map(async (messagingEvent) => {
            const senderPsid = messagingEvent.sender.id;

            // Ignore echo messages sent by the Page to prevent infinite reply loops
            if (messagingEvent.message && !messagingEvent.message.is_echo) {
              const mid = messagingEvent.message.mid;
              if (mid) {
                if (this.processedMids.has(mid)) {
                  logger.warn(`Duplicate webhook message mid detected: ${mid}. Dropping to prevent duplicate reply.`);
                  return;
                }
                this.processedMids.set(mid, Date.now());
              }

              // Rapid tap deduplication (same text from same user within 3 seconds)
              const rawText = messagingEvent.message.text?.trim();
              if (rawText) {
                const dedupKey = `${senderPsid}:${rawText.toLowerCase()}`;
                const lastSeen = this.recentPrompts.get(dedupKey);
                if (lastSeen && Date.now() - lastSeen < 3000) {
                  logger.warn(`Duplicate prompt received within 3s for user ${senderPsid}: "${rawText}". Dropping.`);
                  return;
                }
                this.recentPrompts.set(dedupKey, Date.now());
              }

              await botService.handleIncomingMessage(
                senderPsid,
                messagingEvent.message.text,
                messagingEvent.message.attachments
              );
            }

            // Handle postback events (e.g. Get Started button or Persistent Menu taps)
            if (messagingEvent.postback) {
              const payload = messagingEvent.postback.payload || messagingEvent.postback.title;
              const textToProcess = payload === 'GET_STARTED' ? 'help' : payload;

              const postbackKey = `${senderPsid}:postback:${textToProcess}`;
              const lastSeen = this.recentPrompts.get(postbackKey);
              if (lastSeen && Date.now() - lastSeen < 4000) {
                logger.warn(`Duplicate postback received within 4s for user ${senderPsid}. Dropping.`);
                return;
              }
              this.recentPrompts.set(postbackKey, Date.now());

              await botService.handleIncomingMessage(senderPsid, textToProcess);
            }
          })
        );
      }

      // 2. Process Page Feed / Comment events concurrently
      if (entry.changes && Array.isArray(entry.changes)) {
        await Promise.allSettled(
          entry.changes.map(async (change) => {
            if (change.field === 'feed') {
              const feedValue = change.value;
              // Ignore comments made by the Page itself to prevent self-reply loops
              if (
                feedValue.item === 'comment' &&
                feedValue.verb === 'add' &&
                feedValue.sender_id !== env.facebook.pageId
              ) {
                const commentKey = `comment:${feedValue.comment_id}`;
                if (this.processedMids.has(commentKey)) {
                  return;
                }
                this.processedMids.set(commentKey, Date.now());

                await botService.handleIncomingComment(
                  feedValue.comment_id,
                  feedValue.sender_id,
                  feedValue.message
                );
              }
            }
          })
        );
      }
    }
  }
}

export const webhookService = new WebhookService();
