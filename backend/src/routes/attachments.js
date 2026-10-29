import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAttachment, deleteAttachment } from '../controllers/attachmentController.js';

const router = express.Router();
router.use(requireAuth);

router.get('/:id', getAttachment);
router.delete('/:id', deleteAttachment);

export default router;
