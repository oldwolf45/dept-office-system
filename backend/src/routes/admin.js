import express from 'express';
import { dicts, deleteRecords } from '../controllers/placeholderController.js';
import { requireAuth, requireLevel } from '../middleware/auth.js';
import {
  manualBackup, listBackups, downloadBackup, storage,
  restorePreview, restoreConfirm, restoreAbort, restoreStatus, restoreUploadMiddleware
} from '../controllers/backupController.js';

const router = express.Router();
router.use(requireAuth);

// S12 备份恢复（契约 §2.2）
router.post('/backup', requireLevel(3), manualBackup);
router.get('/backups', requireLevel(3), listBackups);
router.get('/backups/:id/download', requireLevel(3), downloadBackup);
router.get('/storage', requireLevel(3), storage);
router.post('/restore/preview', requireLevel(3), restoreUploadMiddleware, restorePreview);
router.post('/restore/confirm', requireLevel(3), restoreConfirm);
router.post('/restore/abort', requireLevel(3), restoreAbort);
router.get('/restore/status', restoreStatus); // 登录即可（页面维护提示用）

// 既有占位
router.post('/dicts', requireLevel(3), dicts);
router.post('/delete-records', deleteRecords);

export default router;
