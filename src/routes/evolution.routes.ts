import { Router } from 'express';
import { getEvolutionQrCode, syncEvolutionWebhook } from '../controllers/evolution.controller';

const router = Router();

router.get('/tenants/:tenant_id/qrcode', getEvolutionQrCode);
router.post('/tenants/:tenant_id/sync-webhook', syncEvolutionWebhook);

export default router;
