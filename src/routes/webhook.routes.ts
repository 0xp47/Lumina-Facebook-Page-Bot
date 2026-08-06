import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';
import { validateWebhookSignature } from '../middlewares/webhook.middleware';

const router = Router();

// GET /webhook - Verification challenge from Meta Developer Dashboard
router.get('/', webhookController.verifyWebhook.bind(webhookController));

// POST /webhook - Event notification updates (protected by x-hub-signature-256 HMAC validation)
router.post('/', validateWebhookSignature, webhookController.handleWebhookEvent.bind(webhookController));

export default router;
