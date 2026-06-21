import { Router } from 'express';
import { getConnections, manualConnect, getTenantAccounts, getConnectionInfo, getLead, toggleConnectionStatus, kommoStatus, updateAiSettings, getPipelines } from '../controllers/kommo.controller';
import { ensureValidKommoToken } from '../lib/kommo-auth';

const router = Router();

// API Routes used via /api prefix
router.get('/connections', getConnections);
router.post('/connections/manual', manualConnect);
router.get('/tenants/:tenant_id/accounts', getTenantAccounts);
router.get('/connections/info/:tenantId', getConnectionInfo);
router.get('/leads/:tenantId/:phoneNumber', getLead);
router.patch('/connections/:id/toggle', toggleConnectionStatus);
router.patch('/connections/:id/ai-settings', updateAiSettings);
router.get('/connections/:id/pipelines', getPipelines);
router.get('/status', ensureValidKommoToken, kommoStatus);

export default router;
