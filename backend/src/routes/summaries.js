import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  generate, save, finalize, reject, prefer, toggleSample,
  list, detail, exportWord, exportPptx, experienceSamples
} from '../controllers/summaryController.js';

const router = express.Router();

// 逐路由挂 requireAuth（不做 router.use，避免吞掉未匹配路径的 404）
router.get('/experience/samples', requireAuth, experienceSamples);
router.post('/summaries/generate', requireAuth, generate);
router.post('/summaries/:id/save', requireAuth, save);
router.post('/summaries/:id/finalize', requireAuth, finalize);
router.post('/summaries/:id/reject', requireAuth, reject);
router.post('/summaries/:id/prefer', requireAuth, prefer);
router.post('/summaries/:id/toggle-sample', requireAuth, toggleSample);
router.get('/summaries', requireAuth, list);
router.get('/summaries/:id', requireAuth, detail);
router.get('/summaries/:id/export-word', requireAuth, exportWord);
router.get('/summaries/:id/export-pptx', requireAuth, exportPptx);

export default router;
