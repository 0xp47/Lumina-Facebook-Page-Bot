import fs from 'fs';
import path from 'path';
import { graphApiService } from './graphApi.service';
import { SendMessagePayload, SendMessageResponse } from '../types/facebook.types';
import { pageService } from './page.service';
import { nimjiService } from './nimji.service';
import { logger } from '../utils/logger';
import { commandRegistry } from '../commands/registry';
import { env } from '../config/env.config';

export class BotService {
  /** Active locks to prevent duplicate concurrent processing per user */
  private activeUserLocks = new Set<string>();

  /**
   * Mark message as seen ("mark_seen")
   * POST /me/messages { recipient: { id }, sender_action: 'mark_seen' }
   */
  async markSeen(recipientId: string): Promise<void> {
    try {
      await graphApiService.post('/me/messages', {
        recipient: { id: recipientId },
        sender_action: 'mark_seen'
      });
    } catch (err: any) {
      logger.debug(`Mark seen skipped for ${recipientId}: ${err?.message}`);
    }
  }

  /**
   * Send Messenger typing indicator ("typing_on" | "typing_off")
   * POST /me/messages { recipient: { id }, sender_action: 'typing_on' }
   */
  async sendTypingIndicator(recipientId: string, action: 'typing_on' | 'typing_off' = 'typing_on'): Promise<void> {
    try {
      await graphApiService.post('/me/messages', {
        recipient: { id: recipientId },
        sender_action: action
      });
    } catch (err: any) {
      // Non-blocking: fail quietly if typing indicator cannot be delivered
      logger.debug(`Typing indicator (${action}) skipped for ${recipientId}: ${err?.message}`);
    }
  }

  /**
   * Send a direct Messenger message on behalf of the Facebook Page
   * POST /me/messages
   */
  async sendMessage(recipientId: string, messageText: string): Promise<SendMessageResponse> {
    logger.info(`Bot sending message to user PSID: ${recipientId}`);
    const payload: SendMessagePayload = {
      recipient: { id: recipientId },
      message: { text: messageText },
      messaging_type: 'RESPONSE'
    };

    return graphApiService.post<SendMessageResponse>('/me/messages', payload);
  }

  /**
   * Send an image attachment (local file or remote URL) to Facebook Messenger
   */
  async sendImage(recipientId: string, imageSource: string): Promise<void> {
    try {
      // 1. If it's a local file on disk, upload via multipart form-data
      if (fs.existsSync(imageSource)) {
        const fileBytes = await fs.promises.readFile(imageSource);
        const ext = path.extname(imageSource).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const fileName = path.basename(imageSource);

        const form = new FormData();
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append('message', JSON.stringify({
          attachment: {
            type: 'image',
            payload: { is_reusable: true }
          }
        }));
        form.append('filedata', new Blob([fileBytes], { type: mimeType }), fileName);

        const uploadUrl = `${env.facebook.baseUrl}/me/messages?access_token=${env.facebook.pageAccessToken}`;
        const res = await fetch(uploadUrl, {
          method: 'POST',
          body: form
        });

        if (!res.ok) {
          const errText = await res.text();
          logger.warn(`Failed sending local image to FB (${res.status}): ${errText}`);
          return;
        }

        logger.info(`Successfully sent local image ${fileName} to user ${recipientId}`);
        return;
      }

      // 2. If it's a remote URL, dispatch via Graph API URL payload
      if (imageSource.startsWith('http')) {
        await graphApiService.post('/me/messages', {
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'image',
              payload: {
                url: imageSource,
                is_reusable: true
              }
            }
          }
        });
        logger.info(`Successfully sent image URL to user ${recipientId}`);
      }
    } catch (err: any) {
      logger.error(`Error sending image to user ${recipientId}: ${err?.message}`);
    }
  }

  /**
   * Split and send long messages exceeding Facebook's 2,000-character limit
   */
  async sendLongMessage(recipientId: string, fullText: string): Promise<void> {
    const MAX_LENGTH = 1900;
    if (fullText.length <= MAX_LENGTH) {
      await this.sendMessage(recipientId, fullText);
      return;
    }

    // Split text into safe chunks preserving line breaks when possible
    let remaining = fullText;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        await this.sendMessage(recipientId, remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
      if (splitIndex < MAX_LENGTH / 2) {
        splitIndex = remaining.lastIndexOf(' ', MAX_LENGTH);
      }
      if (splitIndex <= 0) {
        splitIndex = MAX_LENGTH;
      }

      const chunk = remaining.slice(0, splitIndex).trim();
      remaining = remaining.slice(splitIndex).trim();
      if (chunk) {
        await this.sendMessage(recipientId, chunk);
      }
    }
  }

  /**
   * Automatic bot logic for incoming Messenger messages and image attachments
   */
  async handleIncomingMessage(
    senderPsid: string,
    messageText?: string,
    attachments?: Array<{ type: string; payload: { url?: string } }>
  ): Promise<void> {
    // Find image attachment if present
    const imageUrl = attachments?.find(a => a.type === 'image' && a.payload?.url)?.payload.url;

    if (!messageText && !imageUrl) return;

    if (this.activeUserLocks.has(senderPsid)) {
      logger.warn(`User ${senderPsid} already has a message in flight. Ignoring duplicate trigger.`);
      return;
    }
    this.activeUserLocks.add(senderPsid);

    const promptText = messageText || '';
    logger.info(`Received Messenger input from ${senderPsid}: text="${promptText}", hasImage=${Boolean(imageUrl)}`);

    // Instant response indicators: mark seen & display typing bubbles immediately
    void this.markSeen(senderPsid);
    void this.sendTypingIndicator(senderPsid, 'typing_on');

    // Keep typing indicator alive every 4s while processing
    const typingTimer = setInterval(() => {
      void this.sendTypingIndicator(senderPsid, 'typing_on');
    }, 4000);

    try {
      // 1. Check if input matches any registered command (e.g. /help, /info, /draw, /search, /post)
      if (promptText) {
        const commandReply = await commandRegistry.findAndExecute(senderPsid, promptText);
        if (commandReply) {
          if (typeof commandReply === 'string') {
            await this.sendLongMessage(senderPsid, commandReply);
          } else {
            if (commandReply.text) {
              await this.sendLongMessage(senderPsid, commandReply.text);
            }
            if (commandReply.images && commandReply.images.length > 0) {
              for (const img of commandReply.images) {
                await this.sendImage(senderPsid, img);
              }
            }
          }
          return;
        }
      }

      // 2. If no command matched, automatically route through Nimji AI (with image support)
      if (nimjiService.isConfigured()) {
        logger.info(`Routing message from ${senderPsid} to Nimji AI (hasImage: ${Boolean(imageUrl)})`);
        const aiReply = await nimjiService.ask(senderPsid, promptText, imageUrl);

        if (aiReply.text) {
          await this.sendLongMessage(senderPsid, aiReply.text);
        }
        if (aiReply.images && aiReply.images.length > 0) {
          for (const img of aiReply.images) {
            await this.sendImage(senderPsid, img);
          }
        }
        return;
      }

      // 3. Fallback response if AI is not configured
      const defaultReply = `Hello! Thanks for reaching out to Lumina.\n\nType "help" to view available commands or chat with our AI assistant Nimji anytime!`;
      await this.sendMessage(senderPsid, defaultReply);
    } finally {
      this.activeUserLocks.delete(senderPsid);
      clearInterval(typingTimer);
      void this.sendTypingIndicator(senderPsid, 'typing_off');
    }
  }

  /**
   * Automatic bot logic for incoming Page comments
   */
  async handleIncomingComment(commentId: string, senderId?: string, messageText?: string): Promise<void> {
    if (!messageText || !commentId) return;

    logger.info(`Received comment ${commentId} from ${senderId}: "${messageText}"`);

    const lower = messageText.toLowerCase();
    if (lower.includes('info') || lower.includes('question') || lower.includes('help')) {
      await pageService.postComment(commentId, {
        message: 'Thanks for reaching out! Please send us a direct message to chat with our AI assistant Nimji anytime.'
      });
    }
  }
}

export const botService = new BotService();
