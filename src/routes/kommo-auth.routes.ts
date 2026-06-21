import { Router } from 'express';
import { connectKommo, kommoCallback } from '../controllers/kommo.controller';

const router = Router();

router.get('/connect', connectKommo);
router.get('/callback', kommoCallback);

export default router;
