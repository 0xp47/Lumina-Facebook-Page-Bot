import { BotCommand } from './command.interface';
import { pageService } from '../services/page.service';
import { env } from '../config/env.config';
import { logger } from '../utils/logger';

/**
 * /post <message text> [| link <url>]
 * Publishes a post to the Page feed directly from Messenger.
 *
 * Examples:
 *   /post Hello everyone, we are open today!
 *   /post Check our new blog article! | link https://example.com/article
 *
 * Security: publishing is restricted to Facebook admin PSIDs listed in
 * FACEBOOK_ADMIN_PSIDS. When no allowlist is configured, only Development
 * mode (where Meta already restricts messaging to app admins/devs/testers)
 * may publish.
 */
function isAuthorized(senderPsid: string): boolean {
  if (env.adminPsids.includes(senderPsid)) return true;
  // No allowlist configured: safest default is to only allow Development mode,
  // where Meta's own platform rules already restrict messaging to app roles.
  return env.adminPsids.length === 0 && env.nodeEnv === 'development';
}

export const postCommand: BotCommand = {
  name: 'post',
  description: '(Admin) Publish a post to the Page feed. Usage: /post <text>',
  aliases: ['publish', 'announce'],

  async execute(senderPsid: string, text: string): Promise<string> {
    if (!isAuthorized(senderPsid)) {
      logger.warn(`Unauthorized /post attempt by PSID ${senderPsid}`);
      return '⛔ You are not authorized to publish posts from this Page.';
    }

    // Everything after the command keyword, e.g. "/post Hello!" -> "Hello!"
    const args = text.trim().split(/\s+/).slice(1).join(' ').trim();
    if (!args) {
      return (
        '⚠️ **Usage**: `/post <message text>`\n' +
        'Optional link: `/post Your text | link https://example.com`\n\n' +
        'Example: `/post Big sale this weekend!`'
      );
    }

    try {
      // Optional link part: "/post text | link https://..."
      let message = args;
      let link: string | undefined;
      const linkMatch = args.match(/\|\s*link\s+(https?:\/\/\S+)/i);
      if (linkMatch) {
        link = linkMatch[1];
        message = args.replace(linkMatch[0], '').trim();
      }

      const result = await pageService.publishPost({ message, link });
      logger.info(`Post published by ${senderPsid}: ${result.id}`);
      return (
        `✅ **Post published!**\n` +
        `• Post ID: ${result.id}\n` +
        `• Content: ${message}${link ? `\n• Link: ${link}` : ''}`
      );
    } catch (error) {
      const message = (error as { message?: string })?.message || 'unknown error';
      logger.error(`Post failed for PSID ${senderPsid}: ${message}`);
      return `❌ Failed to publish the post:\n${message}`;
    }
  }
};
