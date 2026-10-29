import express from 'express';
import {
  generateMonth, listReports, getReport, reportDetail,
  generateSummary, saveSummary, unlockMonth, exportExcel
} from '../controllers/reportController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAccountingView, requireAccountingOperate } from '../middleware/accounting.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', requireAccountingView, listReports);
router.post('/generate-month', requireAccountingOperate, generateMonth);
// 固定路径必须先于 /:month 参数路由注册
router.get('/:month/export', requireAccountingView, exportExcel);
router.get('/:month/:type/detail', requireAccountingView, reportDetail);
router.get('/:month/:type', requireAccountingView, getReport);
router.post('/:month/generate-summary', requireAccountingOperate, generateSummary);
router.post('/:month/save-summary', requireAccountingOperate, saveSummary);
// unlock 内部校验 role=3
router.post('/:month/unlock', requireAccountingView, unlockMonth);

export default router;
