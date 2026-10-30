import fs from 'fs';
import path from 'path';
import os from 'os';
import { createClient, loadConfigFromEnv, uploadImageToGemini } from '../nimji/index';
import type { GemaiClient, GemaiConfig, ImageAttachment } from '../nimji/types';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NimjiResult {
  text: string;
  images: string[];
}

const SYSTEM_PROMPT = `You are Nimji, the official intelligent AI assistant for Lumina on Facebook Messenger.
Key Guidelines:
1. Tone: Welcoming, courteous, smart, and highly professional.
2. Response length: Direct, high-value, and concise. Never repeat the user's question or provide filler disclaimers.
3. Mobile formatting: Optimize for mobile Messenger screens. Use short paragraphs and clear bullet points (•) when helpful.
4. Clean text: Avoid markdown bold asterisks (**) or markdown headers (#) because mobile Facebook Messenger does not render them. Use clean capitalization or bullet points for emphasis.
5. Multimodal Vision: When an image is provided, provide thorough, accurate, and insightful visual analysis.`;

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
    // Clean up XML-like tags e.g. <Image ...>
    .replace(/<Image\s+[^>]*>/gi, '')
    .trim();
}

export class NimjiService {
  private client: GemaiClient | null = null;
  private userHistories = new Map<string, ChatMessage[]>();

  /**
   * Check if Nimji credentials are configured
   */
  public isConfigured(): boolean {
    return Boolean(env.nimji.cookies && env.nimji.atToken && env.nimji.fSid);
  }

  public getConfig(): GemaiConfig {
    return loadConfigFromEnv({
      overrides: {
        COOKIES: env.nimji.cookies,
        AT_TOKEN: env.nimji.atToken,
        F_SID: env.nimji.fSid,
        BL_PARAM: env.nimji.blParam
      }
    });
  }

  private getClient(): GemaiClient {
    if (!this.client) {
      const config = this.getConfig();
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
   * Ask Nimji a question, inspect an image, generate an image, or search Google photos
   */
  public async ask(
    senderPsid: string,
    userPrompt: string,
    inputImageUrl?: string
  ): Promise<NimjiResult> {
    if (!this.isConfigured()) {
      logger.warn('Nimji credentials not configured. Please set COOKIES, AT_TOKEN, and F_SID.');
      return {
        text: '🤖 Nimji AI is currently offline or not configured. Please check back soon!',
        images: []
      };
    }

    if (userPrompt.trim().toLowerCase() === 'reset') {
      this.resetConversation(senderPsid);
      return {
        text: '🔄 Memory cleared! What would you like to talk about next?',
        images: []
      };
    }

    let tempFilePath: string | null = null;
    let imageAttachment: ImageAttachment | undefined;

    // 1. Download and process incoming image attachment if user sent a photo
    if (inputImageUrl) {
      try {
        logger.info(`Downloading user-sent image from Messenger: ${inputImageUrl.slice(0, 60)}...`);
        const imgRes = await fetch(inputImageUrl);
        if (!imgRes.ok) {
          throw new Error(`Failed to download image from Facebook (${imgRes.status})`);
        }
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const tempName = `fb_input_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        tempFilePath = path.join(os.tmpdir(), tempName);
        await fs.promises.writeFile(tempFilePath, imgBuffer);

        const config = this.getConfig();
        imageAttachment = await uploadImageToGemini(config, tempFilePath);
        logger.info(`Uploaded image to Gemini for analysis. Token: ${imageAttachment.tokenPath.slice(0, 35)}...`);
      } catch (err: any) {
        logger.error(`Error processing incoming user photo: ${err?.message}`);
      }
    }

    try {
      const trimmedPrompt = userPrompt.trim();
      let promptSubject = trimmedPrompt;
      let isDraw = false;
      let isSearch = false;

      // Detect /draw or draw command
      const drawMatch = /^\/?(?:draw|image|imagen|generate-image)\s*(.*)$/i.exec(trimmedPrompt);
      if (drawMatch) {
        isDraw = true;
        const subject = drawMatch[1].trim() || 'A modern Lumina house';
        promptSubject = `Create an image of: ${subject}`;
      }

      // Detect /search or find command
      const searchMatch = /^\/?(?:search|search-image|find|find-image)\s*(.*)$/i.exec(trimmedPrompt);
      if (searchMatch) {
        isSearch = true;
        const query = searchMatch[1].trim() || 'Lumina homes house models';
        promptSubject = `Search Google for images of: ${query}`;
      }

      // If user uploaded an image without text, ask Gemini to analyze it
      if (imageAttachment && (!trimmedPrompt || trimmedPrompt === '')) {
        promptSubject = 'Please examine this image in detail and describe what you see, including key features and any relevant insights.';
      }

      const history = this.userHistories.get(senderPsid) || [];
      const historyText = history
        .map(m => `${m.role === 'user' ? 'User' : 'Nimji'}: ${m.content}`)
        .join('\n');

      const promptToSend = [
        `[System: ${SYSTEM_PROMPT}]`,
        historyText ? `\nConversation History:\n${historyText}` : '',
        `\nUser: ${promptSubject}\nNimji:`
      ].filter(Boolean).join('\n');

      const shouldFetchImages = isDraw || isSearch;
      const outputDir = isDraw ? './images/generated' : './images/searched';

      logger.info(
        `Executing Nimji request for user ${senderPsid} (isDraw=${isDraw}, isSearch=${isSearch}, hasAttachment=${Boolean(
          imageAttachment
        )})`
      );

      const client = this.getClient();
      client.resetConversation();

      const res = await client.generate({
        prompt: promptToSend,
        imageAttachment,
        includeImages: shouldFetchImages,
        saveImages: shouldFetchImages,
        imageOutputDir: outputDir
      });

      if (!res.ok) {
        throw res.error;
      }

      // Collect any generated or searched images
      const images: string[] = [];
      if (res.value.savedImagePaths && res.value.savedImagePaths.length > 0) {
        images.push(...res.value.savedImagePaths);
      } else if (res.value.imageUrls && res.value.imageUrls.length > 0) {
        images.push(...res.value.imageUrls);
      }

      let rawText = res.value.text?.trim() || '';

      // Polish text if Imagen 3 returns only internal generation thoughts
      if (isDraw && images.length > 0) {
        if (!rawText || /^(I['’]m now|I['’]ve decided|The details are|Verifying)/i.test(rawText)) {
          rawText = 'Here is the custom image generated for you:';
        }
      } else if (isSearch && images.length > 0) {
        if (!rawText || rawText.startsWith('<Image') || /^(I['’]m now|Searching)/i.test(rawText)) {
          rawText = 'Here are the photos found for your search:';
        }
      }

      if (!rawText && images.length > 0) {
        rawText = 'Here is the image you requested:';
      } else if (!rawText) {
        rawText = 'Hello! I am Nimji. How can I assist you today?';
      }

      const answer = formatForMessenger(rawText);

      // Update multi-turn history (only keep text context for next turns)
      const updatedHistory: ChatMessage[] = [
        ...history,
        { role: 'user', content: trimmedPrompt || (imageAttachment ? '[Sent an image]' : '') },
        { role: 'assistant', content: answer }
      ];
      if (updatedHistory.length > 6) {
        updatedHistory.splice(0, updatedHistory.length - 6);
      }
      this.userHistories.set(senderPsid, updatedHistory);

      return {
        text: answer,
        images
      };
    } catch (error) {
      const errMessage = (error as Error).message || String(error);
      logger.error(`Nimji Gemini execution error: ${errMessage}`);
      return {
        text: '⚠️ Sorry, I encountered an issue while processing your request. Please try again in a moment!',
        images: []
      };
    } finally {
      if (tempFilePath) {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch {
          // ignore cleanup error
        }
      }
    }
  }
}

export const nimjiService = new NimjiService();
