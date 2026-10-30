import { BotCommand } from './command.interface';

export const helpCommand: BotCommand = {
  name: 'help',
  description: 'Displays all available bot commands',
  aliases: ['commands', '?'],
  async execute(_senderPsid: string, _text: string): Promise<string> {
    return (
      '🤖 Available Bot Commands:\n\n' +
      '• nimji <question> - Chat with our intelligent assistant Nimji\n' +
      '• draw <prompt> - Generate custom images via Imagen 3 (e.g. "draw modern living room")\n' +
      '• search <query> - Search Google for real photos (e.g. "search Lumina house models")\n' +
      '• Send a Photo - Upload any image in Messenger and Nimji will analyze and discuss it!\n' +
      '• info - View Facebook Page details and links\n' +
      '• hours - Show our office and response hours\n' +
      '• support - Connect with customer assistance\n' +
      '• post <text> - (Admin) Publish a post directly to the Page'
    );
  }
};
