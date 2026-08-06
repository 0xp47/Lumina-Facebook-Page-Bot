import { Router } from 'express';
import { botController } from '../controllers/bot.controller';

const router = Router();

// POST /api/bot/send-message - Trigger Messenger bot message
router.post('/send-message', botController.sendMessage.bind(botController));

export default router;
