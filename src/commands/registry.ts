import { BotCommand } from './command.interface';
import { helpCommand } from './help';
import { infoCommand } from './info';
import { hoursCommand } from './hours';
import { logger } from '../utils/logger';

export class CommandRegistry {
  private commands: Map<string, BotCommand> = new Map();

  constructor() {
    // Register built-in commands
    this.register(helpCommand);
    this.register(infoCommand);
    this.register(hoursCommand);
  }

  /**
   * Register a new command into the bot system
   */
  public register(command: BotCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias.toLowerCase(), command);
      }
    }
    logger.info(`Registered bot command: /${command.name}`);
  }

  /**
   * Match user text against registered commands and execute
   */
  public async findAndExecute(senderPsid: string, text: string): Promise<string | null> {
    const cleanText = text.trim().toLowerCase();
    const words = cleanText.split(/\s+/);
    const firstWord = words[0].replace(/^\//, ''); // Remove leading slash if user typed /help

    const matchedCommand = this.commands.get(firstWord);
    if (matchedCommand) {
      logger.info(`Executing command /${matchedCommand.name} for user ${senderPsid}`);
      return matchedCommand.execute(senderPsid, text);
    }

    return null;
  }

  /**
   * List all registered commands
   */
  public getCommands(): BotCommand[] {
    const uniqueCommands = new Set(this.commands.values());
    return Array.from(uniqueCommands);
  }
}

export const commandRegistry = new CommandRegistry();
