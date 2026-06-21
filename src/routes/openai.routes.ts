import { Router } from 'express';
import { createProject, getProjects, getCosts, getUsage, getSummary } from '../controllers/openai.controller';

const router = Router();

router.post('/projects', createProject);
router.get('/projects', getProjects);
router.get('/costs', getCosts);
router.get('/usage', getUsage);
router.get('/summary', getSummary);

export default router;
