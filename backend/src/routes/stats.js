import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { workSummary, workDetail, accountingSummary } from '../controllers/statsController.js';

const router = express.Router();
router.use(requireAuth);

router.get('/work-summary', workSummary);
router.get('/work-detail', workDetail);
router.get('/accounting-summary', accountingSummary);

export default router;
