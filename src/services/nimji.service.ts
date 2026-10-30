import { createClient, loadConfigFromEnv } from '../nimji/index';
import type { GemaiClient } from '../nimji/types';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are Nimji, the official intelligent AI assistant for Lumina on Facebook Messenger.
Key Guidelines:
1. Tone: Welcoming, courteous, smart, and highly professional.
2. Response length: Direct, high-value, and concise. Never repeat the user's question or provide filler disclaimers.
3. Mobile formatting: Optimize for mobile Messenger screens. Use short paragraphs and clear bullet points (•) when helpful.
4. Clean text: Avoid markdown bold asterisks (**) or markdown headers (#) because mobile Facebook Messenger does not render them. Use clean capitalization or bullet points for emphasis.`;

/**
 * Format and sanitize response text for Facebook Messenger mobile display
 */
export function formatForMessenger(text: string): string {
  return text
    // Replace markdown bold/italic asterisks: **text** or *text* -> text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.*?)\*/g, '$1')
    // Remove markdown headers: # Header -> Header
    .replace(/^#{1,6}\s+(.*)$/gm, '$1')
    // Remove markdown code blocks if simple: `code` -> code
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export class NimjiService {
  private client: GemaiClient | null = null;
  private userHistories = new Map<string, ChatMessage[]>();

  /**
   * Check if Nimji credentials or official Gemini API key are configured
   */
  public isConfigured(): boolean {
    return Boolean(
      env.nimji.geminiApiKey ||
      (env.nimji.cookies && env.nimji.atToken && env.nimji.fSid)
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
   * Query official Gemini API with ultra-low latency (<800ms)
   */
  private async askOfficialGemini(userPrompt: string, history: ChatMessage[]): Promise<string> {
    const apiKey = env.nimji.geminiApiKey;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const contents = [
      ...history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      })),
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ];

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.7
        }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API error [${res.status}]: ${errBody.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return candidate || 'Hello! I am Nimji, how can I assist you today?';
  }

  /**
   * Query web session scraper with persistent keep-alive client
   */
  private async askScraperGemini(userPrompt: string, history: ChatMessage[]): Promise<string> {
    const historyText = history
      .map(m => `${m.role === 'user' ? 'User' : 'Nimji'}: ${m.content}`)
      .join('\n');

    const promptToSend = [
      `[System: ${SYSTEM_PROMPT}]`,
      historyText ? `\nConversation History:\n${historyText}` : '',
      `\nUser: ${userPrompt}\nNimji:`
    ].filter(Boolean).join('\n');

    const client = this.getClient();
    client.resetConversation();

    const res = await client.generate({
      prompt: promptToSend,
      includeImages: false
    });

    if (!res.ok) {
      throw res.error;
    }

    const rawText = res.value.text?.trim() || 'Hello! I am Nimji. How can I assist you today?';
    return rawText.replace(/^Nimji:\s*/i, '').trim();
  }

  /**
   * Ask Nimji a question with rolling conversation memory per Facebook user
   */
  public async ask(senderPsid: string, userPrompt: string): Promise<string> {
    if (!this.isConfigured()) {
      logger.warn('Nimji credentials not configured. Please set GEMINI_API_KEY or COOKIES, AT_TOKEN, and F_SID.');
      return '🤖 Nimji AI is currently offline or not configured. Please check back soon!';
    }

    if (userPrompt.trim().toLowerCase() === 'reset') {
      this.resetConversation(senderPsid);
      return '🔄 Memory cleared! What would you like to talk about next?';
    }

    const history = this.userHistories.get(senderPsid) || [];
    logger.info(`Sending prompt to Nimji for user ${senderPsid}: "${userPrompt.slice(0, 50)}..."`);

    try {
      let rawAnswer: string;
      if (env.nimji.geminiApiKey) {
        rawAnswer = await this.askOfficialGemini(userPrompt, history);
      } else {
        rawAnswer = await this.askScraperGemini(userPrompt, history);
      }

      // Format response cleanly for Facebook Messenger mobile
      const answer = formatForMessenger(rawAnswer);

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
