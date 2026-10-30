export interface CommandResult {
  text: string;
  images?: string[];
}

export interface BotCommand {
  /** Command keyword trigger (e.g. 'help', 'info', 'support') */
  name: string;
  /** Short description of what the command does */
  description: string;
  /** Optional aliases/triggers (e.g. ['?', 'commands']) */
  aliases?: string[];
  /** Execution method returning the reply string or message payload */
  execute(senderPsid: string, text: string): Promise<string | CommandResult>;
}
