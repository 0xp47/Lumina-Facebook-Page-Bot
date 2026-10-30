import { BotCommand, CommandResult } from './command.interface';
import { nimjiService } from '../services/nimji.service';

export const nimjiCommand: BotCommand = {
  name: 'nimji',
  description: 'Chat with Nimji, our intelligent AI assistant',
  aliases: ['ai', 'gemini', 'ask'],

  async execute(senderPsid: string, text: string): Promise<string | CommandResult> {
    const words = text.trim().split(/\s+/);
    const prompt = words.slice(1).join(' ').trim();

    if (!prompt) {
      return (
        '✨ Nimji AI Assistant\n\n' +
        'Ask me questions, explore property options, generate images, or search for photos!\n\n' +
        '• Chat: nimji <your question>\n' +
        '• Draw: draw <image description>\n' +
        '• Search Photos: search <search query>\n' +
        '• Visual Inspection: send any photo in this chat\n' +
        '• Reset Memory: nimji reset'
      );
    }

    return nimjiService.ask(senderPsid, prompt);
  }
};
