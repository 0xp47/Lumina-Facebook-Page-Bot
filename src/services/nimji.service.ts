import { createClient, loadConfigFromEnv } from '../nimji/index';
import type { GemaiClient } from '../nimji/types';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class NimjiService {
  private client: GemaiClient | null = null;
  private userHistories = new Map<string, ChatMessage[]>();

  /**
   * Check if Nimji credentials are configured
   */
  public isConfigured(): boolean {
    return Boolean(
      env.nimji.cookies &&
      env.nimji.atToken &&
      env.nimji.fSid
    );
  }

  private getClient(): GemaiClient {
    if (!this.client) {
      const config = loadConfigFromEnv({
        overrides: {
          COOKIES: env.nimji.cookies,
          AT_TOKEN: env.nimji.atToken,
          F_SID: env.nimji.fSid,
          BL_PARAM: env.nimji.blParam
        }
      });
      this.client = createClient(config);
    }
    return this.client;
  }

  /**
   * Reset conversation memory for a user
   */
  public resetConversation(senderPsid: string): void {
    this.userHistories.delete(senderPsid);
    logger.info(`Reset Nimji conversation memory for PSID: ${senderPsid}`);
  }

  /**
   * Ask Nimji a question with rolling conversation memory per Facebook user
   */
  public async ask(senderPsid: string, userPrompt: string): Promise<string> {
    if (!this.isConfigured()) {
      logger.warn('Nimji credentials not configured. Please set COOKIES, AT_TOKEN, and F_SID.');
      return '🤖 Nimji AI is currently offline or not configured. Please check back soon!';
    }

    if (userPrompt.trim().toLowerCase() === 'reset') {
      this.resetConversation(senderPsid);
      return '🔄 Memory cleared! What would you like to talk about next?';
    }

    const history = this.userHistories.get(senderPsid) || [];
    const historyText = history
      .map(m => `${m.role === 'user' ? 'User' : 'Nimji'}: ${m.content}`)
      .join('\n');

    const promptToSend = [
      `[System: You are Nimji, the intelligent, friendly, and helpful AI assistant for Lumina. Keep responses concise, clear, and well-formatted for mobile chat.]`,
      historyText ? `\nConversation History:\n${historyText}` : '',
      `\nUser: ${userPrompt}\nNimji:`
    ].filter(Boolean).join('\n');

    logger.info(`Sending prompt to Nimji for user ${senderPsid}: "${userPrompt.slice(0, 50)}..."`);

    try {
      const client = this.getClient();
      // Reset internal conversation tokens to ensure multi-turn history passed in prompt is parsed cleanly
      client.resetConversation();

      const res = await client.generate({
        prompt: promptToSend,
        includeImages: false
      });

      if (!res.ok) {
        throw res.error;
      }

      const rawText = res.value.text?.trim() || 'Hello! I am Nimji. How can I assist you today?';
      // Strip any accidental leading "Nimji:" if the model outputs it
      const answer = rawText.replace(/^Nimji:\s*/i, '').trim();

      // Update rolling history (limit to last 6 messages)
      const updatedHistory: ChatMessage[] = [
        ...history,
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: answer }
      ];
      if (updatedHistory.length > 6) {
        updatedHistory.splice(0, updatedHistory.length - 6);
      }
      this.userHistories.set(senderPsid, updatedHistory);

      return answer;
    } catch (error) {
      const errMessage = (error as Error).message || String(error);
      logger.error(`Nimji Gemini generation error: ${errMessage}`);
      return '⚠️ Sorry, I encountered an issue while processing your request. Please try again in a moment!';
    }
  }
}

export const nimjiService = new NimjiService();
