import { BotCommand, CommandResult } from './command.interface';
import { nimjiService } from '../services/nimji.service';

export const drawCommand: BotCommand = {
  name: 'draw',
  description: 'Generate high-resolution images via Imagen 3 (/draw <prompt>)',
  aliases: ['image', 'imagen', 'generate-image'],

  async execute(senderPsid: string, text: string): Promise<string | CommandResult> {
    const parts = text.trim().split(/\s+/);
    const prompt = parts.slice(1).join(' ').trim();

    if (!prompt) {
      return (
        '🎨 Nimji Image Generator (Imagen 3)\n\n' +
        'Describe whatever you would like to generate!\n\n' +
        '• Usage: draw <prompt> or /image <prompt>\n' +
        '• Example: draw a modern Lumina house with landscaped garden'
      );
    }

    return nimjiService.ask(senderPsid, `/draw ${prompt}`);
  }
};
