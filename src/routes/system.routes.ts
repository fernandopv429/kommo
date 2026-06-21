import { Router } from 'express';
import { getSetting, updateSetting, createLog, getLogs } from '../controllers/system.controller';

const router = Router();

router.get('/settings/:key', getSetting);
router.post('/settings', updateSetting);
router.post('/logs', createLog);
router.get('/tenants/:tenant_id/logs', getLogs);

export default router;
