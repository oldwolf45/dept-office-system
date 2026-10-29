import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import accountingRouter from './routes/accounting.js';
import adminRouter from './routes/admin.js';
import exportRouter from './routes/export.js';
import logsRouter from './routes/logs.js';
import workRouter from './routes/work.js';
import worksRouter from './routes/works.js';
import dictsRouter from './routes/dicts.js';
import attachmentsRouter from './routes/attachments.js';
import settingsRouter from './routes/settings.js';
import dashboardRouter from './routes/dashboard.js';
import annotationsRouter from './routes/annotations.js';
import statsRouter from './routes/stats.js';
import summariesRouter from './routes/summaries.js';
import reportsRouter from './routes/reports.js';
import systemRouter from './routes/system.js';
import { notFound, errorHandler } from './middleware/response.js';
import { maintenanceGuard } from './middleware/maintenance.js';

// 初始化 SQLite（建库 + 幂等建表 + 引导账号）
import './models/db.js';

const app = express();
app.use(express.json());
// S12 维护锁：数据恢复期间写类接口 5030（GET/登录/恢复流程自身放行）
app.use(maintenanceGuard);

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/accounting', accountingRouter);
app.use('/api/admin', adminRouter);
app.use('/api/export', exportRouter);
app.use('/api/logs', logsRouter);
app.use('/api/work', workRouter);
app.use('/api/works', worksRouter);
app.use('/api/dicts', dictsRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api', summariesRouter);
// 全新部署：系统公开信息 + 引导首个管理员（免登录）
app.use('/api', systemRouter);

// 404 与全局错误处理统一走 { code, data, message }
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// 直接 import 本文件（如 supertest）时不监听端口；
// 以 node src/index.js 启动时才监听。
const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  // 每月1日自动生成上月报表初稿（服务启动检查；已生成则幂等跳过锁定）
  (async () => {
    try {
      const db = (await import('./models/db.js')).default;
      const d = new Date();
      d.setDate(1); d.setMonth(d.getMonth() - 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const depts = db.prepare(`SELECT DISTINCT dept_code AS dc FROM users WHERE deleted_at IS NULL`).all();
      for (const { dc } of depts) {
        const exist = db.prepare(
          `SELECT 1 AS x FROM monthly_reports WHERE dept_code=? AND month=? AND report_type='material' LIMIT 1`
        ).get(dc, month);
        if (!exist) {
          const { buildMaterialTable, buildFundTable, buildLedgerTable } = await import('./services/accountingService.js');
          const data = {
            material: buildMaterialTable(dc, month),
            fund: buildFundTable(dc, month),
            ledger: buildLedgerTable(dc)
          };
          for (const t of ['material', 'fund', 'ledger', 'work', 'summary']) {
            db.prepare(`
              INSERT INTO monthly_reports (dept_code, month, report_type, status, data_json, locked)
              VALUES (?, ?, ?, 'archived', ?, 1)
              ON CONFLICT(dept_code, month, report_type) DO NOTHING
            `).run(dc, month, t, JSON.stringify(data[t] ?? null));
          }
          console.log(`[reports] 已自动生成 ${dc} ${month} 月度报表初稿`);
        }
      }
    } catch (e) {
      console.error('[reports] 启动自动生成失败（不影响服务启动）：', e.message);
    }
  })();
  // S12 自动备份：启动时检查一次（03:00-04:00 窗口内当日未成功则执行）+ 每小时轮询
  (async () => {
    try {
      const backupSvc = await import('./services/backupService.js');
      backupSvc.maybeRunAutoBackup(new Date());
      backupSvc.startAutoBackupScheduler();
    } catch (e) {
      console.error('[auto-backup] 启动调度失败（不影响服务启动）：', e.message);
    }
  })();
  app.listen(PORT, () => {
    console.log(`[legacy-office-backend] listening on http://0.0.0.0:${PORT}`);
  });
}

export default app;
