import { BotCommand } from './command.interface';
import { nimjiService } from '../services/nimji.service';

export const nimjiCommand: BotCommand = {
  name: 'nimji',
  description: 'Chat with Nimji, our intelligent AI assistant powered by Google Gemini',
  aliases: ['ai', 'gemini', 'ask'],

  async execute(senderPsid: string, text: string): Promise<string> {
    // Extract everything after the command keyword:
    // e.g. "/nimji what is quantum computing?" -> "what is quantum computing?"
    const words = text.trim().split(/\s+/);
    const prompt = words.slice(1).join(' ').trim();

    if (!prompt) {
      return (
        '✨ **Nimji AI Assistant** (Powered by Google Gemini)\n\n' +
        'Ask me anything, brainstorm ideas, or ask questions about technology, science, or general topics!\n\n' +
        '• **Usage**: `nimji <your question>` or `/ai <question>`\n' +
        '• **Example**: `nimji What are the benefits of cloud computing?`\n' +
        '• **Reset Memory**: `nimji reset`'
      );
    }

    return nimjiService.ask(senderPsid, prompt);
  }
};
