import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { summary, todo, accounting, noticesRead, subordinateActivity } from '../controllers/dashboardController.js';

const router = express.Router();
router.use(requireAuth);

router.get('/summary', summary);
router.get('/todo', todo);
router.get('/accounting', accounting);
router.post('/notices/read', noticesRead);
router.get('/subordinate-activity', subordinateActivity);

export default router;
