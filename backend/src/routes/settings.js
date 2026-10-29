import express from 'express';
import { requireAuth, requireLevel } from '../middleware/auth.js';
import { getStallDays, putStallDays } from '../controllers/settingsController.js';

const router = express.Router();
router.use(requireAuth);

router.get('/stall-days', getStallDays);
router.put('/stall-days', requireLevel(3), putStallDays);

export default router;
