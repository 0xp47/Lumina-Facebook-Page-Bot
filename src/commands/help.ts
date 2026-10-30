import { BotCommand } from './command.interface';

export const helpCommand: BotCommand = {
  name: 'help',
  description: 'Displays all available bot commands',
  aliases: ['commands', '?'],
  async execute(_senderPsid: string, _text: string): Promise<string> {
    return (
      '🤖 **Available Bot Commands**:\n' +
      '• `help` - Show available bot commands\n' +
      '• `nimji <question>` - Ask our AI assistant powered by Gemini (alias: `ai`)\n' +
      '• `info` - Show Facebook Page information\n' +
      '• `hours` - Show operational hours\n' +
      '• `support` - Get customer support contact\n' +
      '• `post <text>` - (Admin) Publish a post to the Page'
    );
  }
};
