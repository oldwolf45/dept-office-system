import express from 'express';
import { bootstrapStatus, systemInfo, bootstrapAdmin } from '../controllers/systemController.js';

// 系统公开接口与引导页（登录前置之外；维护锁之外）
const router = express.Router();
router.get('/system/bootstrap-status', bootstrapStatus);
router.get('/system/info', systemInfo);
router.post('/bootstrap/admin', bootstrapAdmin);

export default router;
