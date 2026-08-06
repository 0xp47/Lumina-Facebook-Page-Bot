import { BotCommand } from './command.interface';

export const hoursCommand: BotCommand = {
  name: 'hours',
  description: 'Shows business operational hours',
  aliases: ['time', 'open'],
  async execute(_senderPsid: string, _text: string): Promise<string> {
    return '⏰ Our online service and automated bot run 24 hours a day, 7 days a week!';
  }
};
