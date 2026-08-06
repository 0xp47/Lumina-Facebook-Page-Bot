import { BotCommand } from './command.interface';

export const helpCommand: BotCommand = {
  name: 'help',
  description: 'Displays all available bot commands',
  aliases: ['commands', 'menu', '?'],
  async execute(_senderPsid: string, _text: string): Promise<string> {
    return (
      '🤖 **Available Bot Commands**:\n' +
      '• `help` - Show this commands menu\n' +
      '• `info` - Show Facebook Page information\n' +
      '• `hours` - Show business opening hours\n' +
      '• `support` - Get customer support contact'
    );
  }
};
