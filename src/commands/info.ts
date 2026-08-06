import { BotCommand } from './command.interface';
import { pageService } from '../services/page.service';

export const infoCommand: BotCommand = {
  name: 'info',
  description: 'Retrieves live details about our Facebook Page',
  aliases: ['about', 'page'],
  async execute(_senderPsid: string, _text: string): Promise<string> {
    try {
      const pageInfo = await pageService.getPageDetails();
      return (
        `📄 **${pageInfo.name || 'Facebook Page'}**\n` +
        `• Category: ${pageInfo.category || 'N/A'}\n` +
        `• Followers: ${pageInfo.followers_count || pageInfo.fan_count || 'N/A'}\n` +
        `• Description: ${pageInfo.about || pageInfo.description || 'Welcome to our Page!'}`
      );
    } catch {
      return '📄 We are an official Facebook Page Bot built with Node.js and TypeScript!';
    }
  }
};
