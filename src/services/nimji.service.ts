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

const SYSTEM_PROMPT = `You are Nimji, the helpful, polite, and intelligent AI assistant for Lumina on Facebook Messenger.
Lumina offers quality, affordable house-and-lot and condominium communities across the Philippines (including Batangas, Cavite, Laguna, Bulacan, Pampanga, Bataan, Rizal, Iloilo, Cebu, Davao, and more). Popular house models include Adriana, Angeli, Armina, Athena, Aira, and Alea, with financing options through Pag-IBIG Fund, Bank financing, and In-house financing.

Guidelines:
1. Tone: Warm, courteous, articulate, and professional.
2. Answers: Direct, helpful, and concise. Never repeat the user's question or provide filler disclaimers.
3. Mobile formatting: Use short paragraphs and clear bullet points (•) where helpful.
4. Clean text: Do not use markdown bold asterisks (**) or markdown headers (#) since Facebook Messenger does not render markdown bold properly on mobile devices.
5. Multimodal Vision: When a photo is provided, examine it carefully and provide clear, insightful observations.`;

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

/**
 * Detect if text is a Gemini canned refusal or internal server error
 */
export function isRefusalOrError(text: string): boolean {
  if (!text) return true;
  const clean = text.trim();
  const lower = clean.toLowerCase();
  if (clean.length < 4) return true;
  if (/^(?:lumina|user|nimji|assistant|ok|yes|no)$/i.test(clean)) return true;
  return (
    lower.includes('having a hard time fulfilling') ||
    lower.includes('something went wrong') ||
    lower.includes('try your request again') ||
    lower.includes('something else instead') ||
    lower.includes('cannot fulfill this request') ||
    lower.includes('i am unable to help')
  );
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
        text: 'Hello! Thank you for reaching out to Lumina. How can I assist you with our home models, reservations, or community locations today?',
        images: []
      };
    }

    if (userPrompt.trim().toLowerCase() === 'reset') {
      this.resetConversation(senderPsid);
      return {
        text: 'Memory cleared! What would you like to ask or explore next?',
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
        promptSubject = 'Please examine this photo in detail and describe what you see, including key features and insights.';
      }

      const history = this.userHistories.get(senderPsid) || [];
      const historyText = history
        .map(m => `${m.role === 'user' ? 'Customer' : 'Nimji'}: ${m.content}`)
        .join('\n');

      const promptToSend = [
        SYSTEM_PROMPT,
        historyText ? `\nPrevious conversation:\n${historyText}` : '',
        `\nCustomer: ${promptSubject}\nNimji:`
      ].filter(Boolean).join('\n\n');

      const shouldFetchImages = isDraw || isSearch;
      const outputDir = isDraw ? './images/generated' : './images/searched';

      logger.info(
        `Executing Nimji request for user ${senderPsid} (isDraw=${isDraw}, isSearch=${isSearch}, hasAttachment=${Boolean(
          imageAttachment
        )})`
      );

      const client = this.getClient();

      // Always pass freshConversation: true so turns never collide or reuse expired tokens
      const res = await client.generate({
        prompt: promptToSend,
        imageAttachment,
        freshConversation: true,
        includeImages: shouldFetchImages,
        saveImages: shouldFetchImages,
        imageOutputDir: outputDir
      });

      // Collect any generated or searched images
      const images: string[] = [];
      if (res.ok) {
        if (res.value.savedImagePaths && res.value.savedImagePaths.length > 0) {
          images.push(...res.value.savedImagePaths);
        } else if (res.value.imageUrls && res.value.imageUrls.length > 0) {
          images.push(...res.value.imageUrls);
        }
      }

      let rawText = res.ok ? (res.value.text?.trim() || '') : '';

      // If Gemini returned a canned refusal, internal error, or empty output, retry once cleanly
      if (!res.ok || isRefusalOrError(rawText)) {
        logger.warn(
          `Initial response was an error or refusal ("${rawText.slice(0, 60)}"). Retrying with clean standalone prompt...`
        );
        const retryRes = await client.generate({
          prompt: `${SYSTEM_PROMPT}\n\nCustomer: ${promptSubject}\nNimji:`,
          imageAttachment,
          freshConversation: true,
          includeImages: shouldFetchImages,
          saveImages: shouldFetchImages,
          imageOutputDir: outputDir
        });

        if (retryRes.ok && retryRes.value.text && !isRefusalOrError(retryRes.value.text)) {
          rawText = retryRes.value.text.trim();
          if (retryRes.value.savedImagePaths?.length) {
            images.push(...retryRes.value.savedImagePaths);
          } else if (retryRes.value.imageUrls?.length) {
            images.push(...retryRes.value.imageUrls);
          }
        }
      }

      // Polish text for generated or searched images
      if (isDraw && images.length > 0) {
        if (!rawText || /^(I['’]m now|I['’]ve decided|The details are|Verifying)/i.test(rawText) || isRefusalOrError(rawText)) {
          rawText = 'Here is the custom image created for you:';
        }
      } else if (isSearch && images.length > 0) {
        if (!rawText || rawText.startsWith('<Image') || /^(I['’]m now|Searching)/i.test(rawText) || isRefusalOrError(rawText)) {
          rawText = 'Here are the photos found for your search:';
        }
      }

      // If still empty or refusal after retry, deliver a graceful contextual message
      if (isRefusalOrError(rawText) || !rawText) {
        if (images.length > 0) {
          rawText = 'Here is the image you requested:';
        } else {
          rawText = 'Hello! Thank you for contacting Lumina. How can I assist you today with our available house models, reservations, or community locations?';
        }
      }

      const answer = formatForMessenger(rawText);

      // Update multi-turn history (only keep clean text context for next turns)
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
        text: 'Hello! Thank you for contacting Lumina. How can I assist you today with our available house models, reservations, or community locations?',
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
