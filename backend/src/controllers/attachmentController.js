import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { ok, fail } from '../middleware/response.js';
import workModel from '../models/workModel.js';
import logModel from '../models/logModel.js';
import { canViewWork } from '../services/workService.js';
import { DATA_DIR } from '../models/db.js';

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 白名单（契约 §2.5 / 第11节）
const EXT_WHITELIST = new Set(['doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'png', 'mp3', 'wav', 'm4a', 'mp4', 'mov']);
const MAX_BYTES = () => Number(process.env.ATTACHMENT_MAX_BYTES) || 200 * 1024 * 1024;

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
// 内联预览类型（audio/video/image/pdf）
const INLINE_EXT = new Set(['pdf', 'jpg', 'png', 'mp3', 'wav', 'm4a', 'mp4', 'mov']);

function extOf(filename) {
  const base = String(filename || '').split('?')[0];
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = extOf(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES() },
  fileFilter: (req, file, cb) => {
    const ext = extOf(file.originalname);
    if (!EXT_WHITELIST.has(ext)) {
      req.__rejectReason = `文件类型".${ext}"不允许，仅支持: ${[...EXT_WHITELIST].join('/')}`;
      return cb(null, false);
    }
    return cb(null, true);
  }
});

// multer 中间件包装：统一把体积超限/非白名单转成 4000 中文提示
export function uploadAttachmentMiddleware(req, res, next) {
  const mw = upload.single('file');
  mw(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return fail(res, 4000, `文件大小超过上限（${Math.round(MAX_BYTES() / 1024 / 1024)}MB）`);
      }
      return fail(res, 4000, err.message || '文件上传失败');
    }
    if (!req.file) {
      return fail(res, 4000, req.__rejectReason || '未收到文件，请使用 multipart 字段 file');
    }
    return next();
  });
}

// POST /api/works/:id/attachments  {progressId?}
export async function uploadAttachment(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  if (!canViewWork(me, work)) return fail(res, 4030, '无权限上传附件到该工作');

  // 已取消/已改派的工作不收附件
  if (work.status === '已取消' || work.status === '已改派') {
    fs.unlink(req.file.path, () => {});
    return fail(res, 4000, `当前状态(${work.status})不可上传附件`);
  }

  let progressId = null;
  if (req.body && req.body.progressId) {
    const pid = Number(req.body.progressId);
    const prog = workModel.findProgress(pid);
    if (!prog || prog.workId !== work.id) {
      fs.unlink(req.file.path, () => {});
      return fail(res, 4000, '绑定的进度不存在');
    }
    progressId = pid;
  }

  // multer 默认按 latin1 解析 multipart 文件名，中文需还原为 utf-8
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const ext = extOf(originalName);
  const record = workModel.addAttachment({
    workId: work.id,
    progressId,
    uploaderId: me.id,
    originalName,
    storedName: req.file.filename,
    mimeType: MIME_BY_EXT[ext] || null,
    size: req.file.size
  });
  // 任何附件上传都更新 last_progress_at（F59 含附件/说明）
  workModel.touchProgress(work.id);
  return ok(res, record, '上传成功');
}

// GET /api/attachments/:id  —— 内联预览 / 下载
export async function getAttachment(req, res) {
  const me = req.currentUser;
  const record = workModel.findAttachment(Number(req.params.id));
  if (!record) return fail(res, 4040, '附件不存在或已删除');
  const work = workModel.findById(record.workId);
  if (!work || !canViewWork(me, work)) return fail(res, 4030, '无权限查看该附件');

  const filePath = path.join(UPLOAD_DIR, record.storedName);
  if (!fs.existsSync(filePath)) return fail(res, 4040, '附件文件缺失');

  const ext = extOf(record.storedName);
  res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  if (INLINE_EXT.has(ext)) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.originalName)}"`);
  } else {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(record.originalName)}"`);
  }
  return res.sendFile(filePath);
}

// DELETE /api/attachments/:id  —— 上传人本人或科长，软删除留痕
export async function deleteAttachment(req, res) {
  const me = req.currentUser;
  const record = workModel.findAttachment(Number(req.params.id));
  if (!record) return fail(res, 4040, '附件不存在或已删除');
  const isUploader = record.uploaderId === me.id;
  if (!isUploader && me.role !== 3) return fail(res, 4030, '仅上传人本人或科长可删除附件');
  workModel.softDeleteAttachment(record.id);
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'delete_attachment',
    targetType: 'attachment',
    targetId: record.id,
    detail: { workId: record.workId, originalName: record.originalName }
  });
  return ok(res, null, '已删除');
}
