import { graphApiService } from './graphApi.service';
import { SendMessagePayload, SendMessageResponse } from '../types/facebook.types';
import { pageService } from './page.service';
import { nimjiService } from './nimji.service';
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
   * Automatic bot logic for incoming Messenger messages
   */
  async handleIncomingMessage(senderPsid: string, messageText?: string): Promise<void> {
    if (!messageText) return;

    logger.info(`Received Messenger text from ${senderPsid}: "${messageText}"`);

    // 1. Check if input matches any registered command (e.g. /help, /info, /nimji, /post)
    const commandReply = await commandRegistry.findAndExecute(senderPsid, messageText);
    if (commandReply) {
      await this.sendLongMessage(senderPsid, commandReply);
      return;
    }

    // 2. If no command matched, automatically route through Nimji AI if configured
    if (nimjiService.isConfigured()) {
      logger.info(`Routing freeform message from ${senderPsid} to Nimji AI`);
      const aiReply = await nimjiService.ask(senderPsid, messageText);
      await this.sendLongMessage(senderPsid, aiReply);
      return;
    }

    // 3. Fallback response if AI is not configured
    const defaultReply = `Hello! Thanks for reaching out. Type "help" to view available commands or "nimji <question>" to chat with our AI assistant.`;
    await this.sendMessage(senderPsid, defaultReply);
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
