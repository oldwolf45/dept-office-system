import express from 'express';
import { exportSummary } from '../controllers/placeholderController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.post('/summary', exportSummary);

export default router;
