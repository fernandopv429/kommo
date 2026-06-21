import { Router } from 'express';
import { kommoWebhook, evolutionWebhook } from '../controllers/webhooks.controller';

const router = Router();

router.post('/kommo', kommoWebhook);
router.post('/evolution/:tenantId', evolutionWebhook);

export default router;
