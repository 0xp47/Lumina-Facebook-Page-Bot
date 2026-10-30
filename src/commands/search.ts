import { BotCommand, CommandResult } from './command.interface';
import { nimjiService } from '../services/nimji.service';

export const searchCommand: BotCommand = {
  name: 'search',
  description: 'Search Google for images (/search <query>)',
  aliases: ['find', 'search-image', 'find-image'],

  async execute(senderPsid: string, text: string): Promise<string | CommandResult> {
    const parts = text.trim().split(/\s+/);
    const query = parts.slice(1).join(' ').trim();

    if (!query) {
      return (
        '🔍 Google Image Search via Nimji\n\n' +
        'Search for real photos, models, or design ideas!\n\n' +
        '• Usage: search <query> or /find <query>\n' +
        '• Example: search Lumina homes Adriana townhouse facade'
      );
    }

    return nimjiService.ask(senderPsid, `/search ${query}`);
  }
};
