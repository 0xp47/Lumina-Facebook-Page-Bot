import { BotCommand } from './command.interface';

export const supportCommand: BotCommand = {
  name: 'support',
  description: 'Provides customer support contact channels',
  aliases: ['contact', 'helpdesk', 'agent'],
  async execute(_senderPsid: string, _text: string): Promise<string> {
    return (
      '📞 **Customer Support**:\n' +
      '• Direct Message: Send us your question here anytime.\n' +
      '• Business Hours: 24/7 Automated Assistant\n' +
      '• For live agent assistance, leave your inquiry and our team will get back to you shortly!'
    );
  }
};
