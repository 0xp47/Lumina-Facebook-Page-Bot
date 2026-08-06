import { graphApiService } from './graphApi.service';
import { SendMessagePayload, SendMessageResponse } from '../types/facebook.types';
import { pageService } from './page.service';
import { logger } from '../utils/logger';

import { commandRegistry } from '../commands/registry';

export class BotService {
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
   * Automatic bot logic for incoming Messenger messages
   */
  async handleIncomingMessage(senderPsid: string, messageText?: string): Promise<void> {
    if (!messageText) return;

    logger.info(`Received Messenger text from ${senderPsid}: "${messageText}"`);

    // 1. Check if input matches any registered command
    const commandReply = await commandRegistry.findAndExecute(senderPsid, messageText);
    if (commandReply) {
      await this.sendMessage(senderPsid, commandReply);
      return;
    }

    // 2. Default fallback response
    const defaultReply = `Hello! Thanks for reaching out. Type "help" or "/" to view available commands.`;
    await this.sendMessage(senderPsid, defaultReply);
  }

  /**
   * Automatic bot logic for incoming Page comments
   */
  async handleIncomingComment(commentId: string, senderId?: string, messageText?: string): Promise<void> {
    if (!messageText || !commentId) return;

    logger.info(`Received comment ${commentId} from ${senderId}: "${messageText}"`);

    const lower = messageText.toLowerCase();
    if (lower.includes('price') || lower.includes('cost') || lower.includes('buy')) {
      await pageService.postComment(commentId, {
        message: 'Thanks for reaching out! Please send us a direct message for pricing details.'
      });
    }
  }
}

export const botService = new BotService();
