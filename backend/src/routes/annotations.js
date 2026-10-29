import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { replyAnnotation } from '../controllers/workController.js';

const router = express.Router();
router.use(requireAuth);

router.post('/:id/reply', replyAnnotation);

export default router;
