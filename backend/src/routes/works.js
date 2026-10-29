import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listWorks, workDetail, createWork, updateWork, completeWork, cancelWork,
  unlockWork, addProgress, transferWork, createAnnotation
} from '../controllers/workController.js';
import {
  uploadAttachmentMiddleware, uploadAttachment
} from '../controllers/attachmentController.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', listWorks);
router.post('/', createWork);
router.get('/:id', workDetail);
router.put('/:id', updateWork);
router.post('/:id/complete', completeWork);
router.post('/:id/cancel', cancelWork);
router.post('/:id/unlock', unlockWork);
router.post('/:id/progress', addProgress);
router.post('/:id/transfer', transferWork);
router.post('/:id/annotations', createAnnotation);
router.post('/:id/attachments', uploadAttachmentMiddleware, uploadAttachment);

export default router;
