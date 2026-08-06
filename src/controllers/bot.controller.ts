import { Request, Response, NextFunction } from 'express';
import { botService } from '../services/bot.service';

export class BotController {
  async sendMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { recipientId, message } = req.body;
      if (!recipientId || !message) {
        res.status(400).json({
          success: false,
          error: 'Fields "recipientId" and "message" are required'
        });
        return;
      }

      const result = await botService.sendMessage(recipientId, message);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const botController = new BotController();
