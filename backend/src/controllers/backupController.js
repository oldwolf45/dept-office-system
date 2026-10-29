// S12 备份恢复 HTTP 接口（契约 §2.2）；权限由路由层 requireLevel(3) 把关，restore/status 登录即可
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { ok, fail } from '../middleware/response.js';
import * as backupSvc from '../services/backupService.js';

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `restore-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});
export const restoreUploadMiddleware = restoreUpload.single('file');

// POST /api/admin/backup —— 仅科长；同步生成 ZIP，失败不生成半成品
export async function manualBackup(req, res) {
  try {
    const r = backupSvc.runBackup('manual', { operator: req.currentUser });
    return ok(res, { id: r.id, name: r.name, size: r.size, sha256: r.sha256 });
  } catch (e) {
    return fail(res, e.code || 4000, e.message);
  }
}

// GET /api/admin/backups —— 备份记录列表
export async function listBackups(req, res) {
  return ok(res, { list: backupSvc.listBackups() });
}

// GET /api/admin/backups/:id/download —— 下载 ZIP
export async function downloadBackup(req, res) {
  const row = backupSvc.getBackupRow(Number(req.params.id));
  if (!row) return fail(res, 4000, '备份记录不存在');
  const p = path.join(backupSvc.BACKUP_DIR, row.file_name);
  if (!fs.existsSync(p)) return fail(res, 4000, '备份文件已不存在（可能已被轮转清理）');
  return res.download(p, row.file_name);
}

// GET /api/admin/storage —— 备份目录占用 + 磁盘剩余 + 阈值提醒
export async function storage(req, res) {
  return ok(res, backupSvc.storageInfo());
}

// POST /api/admin/restore/preview —— 上传 ZIP → 校验 → 返回预览（当前数据不变）
export async function restorePreview(req, res) {
  if (!req.file) return fail(res, 4000, '请上传备份 ZIP 文件（字段名 file）');
  try {
    const { token, manifest } = backupSvc.createPreviewToken(req.file.path);
    return ok(res, {
      previewToken: token,
      backupTime: manifest.backupTime,
      systemVersion: manifest.systemVersion,
      schemaVersion: manifest.dbSchemaVersion,
      recordCounts: manifest.recordCounts,
      attachmentCount: manifest.attachmentCount,
      totalSize: manifest.totalSize
    });
  } catch (e) {
    try { fs.rmSync(req.file.path, { force: true }); } catch { /* 忽略 */ }
    return fail(res, e.code || 4000, e.message);
  }
}

// POST /api/admin/restore/confirm {previewToken, overwrite:'覆盖当前数据'}
export async function restoreConfirm(req, res) {
  try {
    const out = backupSvc.confirmRestore({
      token: req.body?.previewToken,
      overwrite: req.body?.overwrite,
      operator: req.currentUser
    });
    return ok(res, { ...out, requireRelogin: true });
  } catch (e) {
    return fail(res, e.code || 4000, e.message);
  }
}

// POST /api/admin/restore/abort —— 失败回滚用：用临时备份还原并保留
export async function restoreAbort(req, res) {
  try {
    const out = backupSvc.abortRestore({ operator: req.currentUser, reason: req.body?.reason });
    return ok(res, { ...out, requireRelogin: true });
  } catch (e) {
    return fail(res, e.code || 4000, e.message);
  }
}

// GET /api/admin/restore/status —— 登录即可（恢复期间页面显示维护提示）
export async function restoreStatus(req, res) {
  return ok(res, backupSvc.restoreStatus());
}
