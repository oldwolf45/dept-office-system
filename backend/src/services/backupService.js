// S12 备份/恢复核心服务（PRD 第7节，契约 §2）
// 备份 ZIP：db/（checkpoint 后单库 app.db）+ attachments/（未删除附件物理文件）+ config/（白名单非敏感配置 JSON）+ manifest.json（逐文件 SHA-256）
// 恢复：预览校验 → 二次确认 → 临时备份当前数据 → 维护锁 → 临时目录解压校验 → 整体替换 → 校验记录数/附件数 → 释放锁
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import db, { DATA_DIR, closeDatabase, reopenDatabase, checkpointWal } from '../models/db.js';
import logModel from '../models/logModel.js';

export const SYSTEM_VERSION = 'V2.5';
export const DB_SCHEMA_VERSION = 1;
export const AUTO_KEEP = 7; // 自动备份保留最近 7 份

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const RESTORE_TMP_DIR = path.join(DATA_DIR, 'restore-tmp');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// settings 白名单：只导出这些非敏感配置，严禁任何环境变量/API Key
const CONFIG_WHITELIST = ['company_name', 'stall_days'];

// 清单记录数覆盖的业务表（manifest 校验用）
const RECORD_COUNT_TABLES = [
  'users', 'login_logs', 'operation_logs', 'delegations', 'works', 'work_transfers', 'dicts',
  'progress_records', 'attachments', 'annotations', 'summary_archives',
  'material_items', 'material_plans', 'material_receipts', 'material_batches', 'material_issues',
  'stocktakings', 'stocktaking_items', 'accounting_approvals',
  'fund_plans', 'fund_expenses', 'fund_settlements', 'monthly_reports',
  'notice_reads', 'backup_logs'
];

function biz(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function pad(n) { return String(n).padStart(2, '0'); }
function fmtLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function tsName(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function collectRecordCounts() {
  const out = {};
  for (const t of RECORD_COUNT_TABLES) {
    try { out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
    catch { out[t] = 0; }
  }
  return out;
}

// ===== 维护锁（恢复期间写类接口 5030）=====
let maintenanceLocked = false;
export function isMaintenanceLocked() { return maintenanceLocked; }
export function __testSetMaintenance(v) { maintenanceLocked = !!v; }

// ===== 测试钩子：confirm 流程中注入失败（回滚用例）=====
export const testHooks = { onBeforeSwap: null };

// ===== 预览会话：token -> {zipPath, manifest, createdAt} =====
const previewTokens = new Map();

// ===== 生成一个备份 ZIP 到指定路径（不写 backup_logs；调用方负责）=====
export function createBackup(zipPath, { now = new Date() } = {}) {
  checkpointWal();
  const zip = new AdmZip();
  const files = []; // {path, sha256, size}

  // 1. db/app.db（checkpoint 后单文件一致）
  const dbBuf = fs.readFileSync(path.join(DATA_DIR, 'app.db'));
  files.push({ path: 'db/app.db', sha256: sha256Buf(dbBuf), size: dbBuf.length });
  zip.addFile('db/app.db', dbBuf);

  // 2. attachments/（未删除附件的物理文件）
  const rows = db.prepare(`SELECT stored_name FROM attachments WHERE deleted_at IS NULL`).all();
  let attachmentCount = 0;
  for (const r of rows) {
    const p = path.join(UPLOAD_DIR, r.stored_name);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    files.push({ path: `attachments/${r.stored_name}`, sha256: sha256Buf(buf), size: buf.length });
    zip.addFile(`attachments/${r.stored_name}`, buf);
    attachmentCount += 1;
  }

  // 3. config/（白名单非敏感配置）
  const cfg = {};
  for (const k of CONFIG_WHITELIST) {
    const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(k);
    if (row) cfg[k] = row.value;
  }
  const cfgBuf = Buffer.from(JSON.stringify(cfg, null, 2), 'utf8');
  files.push({ path: 'config/config.json', sha256: sha256Buf(cfgBuf), size: cfgBuf.length });
  zip.addFile('config/config.json', cfgBuf);

  const recordCounts = collectRecordCounts();
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const manifest = {
    backupTime: fmtLocal(now),
    systemVersion: SYSTEM_VERSION,
    dbSchemaVersion: DB_SCHEMA_VERSION,
    recordCounts,
    attachmentCount,
    totalSize,
    files
  };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.writeZip(zipPath);
  const onDisk = fs.readFileSync(zipPath);
  return { manifest, size: onDisk.length, sha256: sha256Buf(onDisk) };
}

// ===== 校验备份 ZIP：可打开/有清单/逐文件 SHA-256/系统版本/DB 结构版本；不动当前数据 =====
export function verifyBackupFile(zipPath) {
  let zip;
  try { zip = new AdmZip(zipPath); }
  catch { throw biz(4000, '备份文件无法打开（已损坏或不是 ZIP）'); }
  const mfEntry = zip.getEntry('manifest.json');
  if (!mfEntry) throw biz(4000, '备份包缺少 manifest.json 清单');
  let manifest;
  try { manifest = JSON.parse(zip.readAsText(mfEntry)); }
  catch { throw biz(4000, 'manifest.json 清单损坏'); }
  if (manifest.systemVersion !== SYSTEM_VERSION) {
    throw biz(4000, `系统版本不兼容（备份包=${manifest.systemVersion}，当前=${SYSTEM_VERSION}）`);
  }
  if (Number(manifest.dbSchemaVersion) !== DB_SCHEMA_VERSION) {
    throw biz(4000, `数据库结构版本不兼容（备份包=${manifest.dbSchemaVersion}，当前=${DB_SCHEMA_VERSION}）`);
  }
  for (const f of manifest.files || []) {
    const e = zip.getEntry(f.path);
    if (!e) throw biz(4000, `备份包缺少文件 ${f.path}`);
    const h = sha256Buf(zip.readFile(e));
    if (h !== f.sha256) throw biz(4000, `文件 ${f.path} 校验值不符，备份可能已损坏`);
  }
  return manifest;
}

// 解压到临时目录（恢复前校验通过才会走到这里）
function extractTo(zipPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  return destDir;
}

// ===== 用一个已校验 ZIP 整体替换当前 db/attachments/config（confirm 与回滚共用）=====
export function swapFromZip(zipPath) {
  const manifest = verifyBackupFile(zipPath); // 不动当前数据
  const extractDir = path.join(RESTORE_TMP_DIR, `extract-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  extractTo(zipPath, extractDir);

  if (typeof testHooks.onBeforeSwap === 'function') testHooks.onBeforeSwap();

  try {
    closeDatabase();
    // 1. 替换 db 文件
    for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
      const p = path.join(DATA_DIR, f);
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
    fs.copyFileSync(path.join(extractDir, 'db', 'app.db'), path.join(DATA_DIR, 'app.db'));
    // 2. 替换附件目录
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const attDir = path.join(extractDir, 'attachments');
    if (fs.existsSync(attDir)) {
      for (const name of fs.readdirSync(attDir)) {
        fs.copyFileSync(path.join(attDir, name), path.join(UPLOAD_DIR, name));
      }
    }
    // 3. 重开连接 + 幂等 DDL
    reopenDatabase();
    // 4. config 白名单写回 settings
    const cfgPath = path.join(extractDir, 'config', 'config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      for (const k of CONFIG_WHITELIST) {
        if (cfg[k] !== undefined) {
          db.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')
          `).run(k, String(cfg[k]));
        }
      }
    }
    // 5. 恢复后校验：记录数/附件数对照清单，列出异常
    const anomalies = [];
    const current = collectRecordCounts();
    for (const [t, expected] of Object.entries(manifest.recordCounts || {})) {
      if (current[t] !== expected) anomalies.push({ table: t, expected, actual: current[t] });
    }
    const attCount = db.prepare(`SELECT COUNT(*) AS n FROM attachments WHERE deleted_at IS NULL`).get().n;
    if (manifest.attachmentCount !== attCount) {
      anomalies.push({ table: 'attachments', expected: manifest.attachmentCount, actual: attCount });
    }
    return { manifest, recordCounts: current, attachmentCount: attCount, anomalies };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

// ===== 记录一条备份（成功写 backup_logs + operation_logs；失败也记录并清理半成品）=====
export function runBackup(type = 'manual', { now = new Date(), backupDir = BACKUP_DIR, operator = null } = {}) {
  if (type !== 'manual' && type !== 'auto') throw biz(4000, '备份类型只能是 manual/auto');
  const name = `ke_work_backup_${tsName(now)}_${type}.zip`;
  const zipPath = path.join(backupDir, name);
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const { manifest, size, sha256 } = createBackup(zipPath, { now });
    const info = db.prepare(`
      INSERT INTO backup_logs (file_name, file_size, sha256, type, status, backup_time, record_counts, attachment_count, total_size, schema_version)
      VALUES (?, ?, ?, ?, 'success', ?, ?, ?, ?, ?)
    `).run(name, size, sha256, type, manifest.backupTime, JSON.stringify(manifest.recordCounts), manifest.attachmentCount, manifest.totalSize, DB_SCHEMA_VERSION);
    const id = Number(info.lastInsertRowid);
    logModel.addOperationLog({
      operatorId: operator?.id ?? null, operatorName: operator?.name ?? 'system',
      actionType: type === 'auto' ? 'auto_backup' : 'manual_backup',
      targetType: 'backup', targetId: id, detail: { fileName: name, size, type }
    });
    if (type === 'auto') rotateAutoBackups();
    return { id, name, size, sha256, manifest };
  } catch (e) {
    // 失败不生成半成品
    if (fs.existsSync(zipPath)) { try { fs.rmSync(zipPath, { force: true }); } catch { /* 忽略 */ } }
    db.prepare(`
      INSERT INTO backup_logs (file_name, file_size, sha256, type, status, reason, backup_time)
      VALUES (?, 0, NULL, ?, 'failed', ?, ?)
    `).run(name, type, e.message, fmtLocal(now));
    logModel.addOperationLog({
      operatorId: operator?.id ?? null, operatorName: operator?.name ?? 'system',
      actionType: type === 'auto' ? 'auto_backup_failed' : 'manual_backup_failed',
      targetType: 'backup', detail: { fileName: name, reason: e.message }
    });
    throw e;
  }
}

// 自动备份轮转：成功后只保留最近 AUTO_KEEP 份 auto（删文件+记录）；手动备份不动
function rotateAutoBackups() {
  const rows = db.prepare(
    `SELECT id, file_name AS fileName FROM backup_logs WHERE type='auto' AND status='success' ORDER BY id DESC`
  ).all();
  for (const r of rows.slice(AUTO_KEEP)) {
    const p = path.join(BACKUP_DIR, r.fileName);
    if (fs.existsSync(p)) { try { fs.rmSync(p, { force: true }); } catch { /* 忽略 */ } }
    db.prepare(`DELETE FROM backup_logs WHERE id=?`).run(r.id);
  }
}

// ===== 自动备份调度：每日 03:00-04:00 时段且当日未成功执行则执行（可注入时间）=====
export function maybeRunAutoBackup(now = new Date()) {
  if (now.getHours() < 3 || now.getHours() >= 4) return { ran: false, reason: 'outside-window' };
  const today = localDay(now);
  // 按备份时间 backup_time（可注入）判断当日是否已成功
  const done = db.prepare(
    `SELECT 1 AS x FROM backup_logs WHERE type='auto' AND status='success' AND substr(backup_time,1,10)=? LIMIT 1`
  ).get(today);
  if (done) return { ran: false, reason: 'already-done' };
  try {
    const result = runBackup('auto', { now });
    return { ran: true, result };
  } catch (e) {
    return { ran: true, error: e.message };
  }
}

export function startAutoBackupScheduler() {
  return setInterval(() => {
    try { maybeRunAutoBackup(new Date()); } catch (e) { console.error('[auto-backup] 调度失败：', e.message); }
  }, 60 * 60 * 1000);
}

// ===== 首页 backupFailure 待办：最近一次自动备份成功之后仍存在的失败（"未解决"的失败）=====
export function unresolvedAutoFailures() {
  return db.prepare(`
    SELECT id, file_name AS fileName, reason, created_at AS createdAt, backup_time AS backupTime
    FROM backup_logs f
    WHERE f.type='auto' AND f.status='failed'
      AND COALESCE(f.backup_time, f.created_at) > COALESCE(
        (SELECT MAX(COALESCE(backup_time, created_at)) FROM backup_logs WHERE type='auto' AND status='success'), '1970-01-01')
    ORDER BY f.id DESC
  `).all();
}

// ===== 列表 / 记录 / 下载 =====
export function listBackups() {
  return db.prepare(`
    SELECT id, file_name AS fileName, file_size AS fileSize, sha256, type, status, reason,
           created_at AS createdAt, backup_time AS backupTime, attachment_count AS attachmentCount,
           total_size AS totalSize, schema_version AS schemaVersion
    FROM backup_logs ORDER BY id DESC
  `).all();
}

export function getBackupRow(id) {
  return db.prepare(`SELECT * FROM backup_logs WHERE id=?`).get(Number(id));
}

// ===== 存储统计：备份目录占用 + 磁盘剩余（statfs）+ 阈值提醒 =====
export function storageInfo() {
  const files = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter((f) => f.toLowerCase().endsWith('.zip'))
    : [];
  let usedBytes = 0;
  for (const f of files) {
    try { usedBytes += fs.statSync(path.join(BACKUP_DIR, f)).size; } catch { /* 忽略 */ }
  }
  let freeBytes = 0; let totalBytes = 0;
  try {
    const s = fs.statfsSync(BACKUP_DIR);
    freeBytes = Number(s.bavail) * Number(s.bsize);
    totalBytes = Number(s.blocks) * Number(s.bsize);
  } catch { /* statfs 不可用时留 0 */ }
  const thresholdBytes = 500 * 1024 * 1024;
  return {
    backupDir: BACKUP_DIR,
    usedBytes,
    fileCount: files.length,
    autoKept: db.prepare(`SELECT COUNT(*) AS n FROM backup_logs WHERE type='auto' AND status='success'`).get().n,
    manualKept: db.prepare(`SELECT COUNT(*) AS n FROM backup_logs WHERE type='manual' AND status='success'`).get().n,
    freeBytes,
    totalBytes,
    thresholdBytes,
    warning: freeBytes > 0 && freeBytes < thresholdBytes
  };
}

// ===== 恢复预览：上传 ZIP → 校验 → 发 token（当前数据不动）=====
export function createPreviewToken(zipPath) {
  const manifest = verifyBackupFile(zipPath);
  const token = crypto.randomBytes(16).toString('hex');
  previewTokens.set(token, { zipPath, manifest, createdAt: new Date() });
  return { token, manifest };
}

// ===== 恢复确认：overwrite 字面量校验 → 临时备份当前数据 → 维护锁 → 整体替换 → 校验 → 释放锁；失败自动回滚 =====
export function confirmRestore({ token, overwrite, operator }) {
  if (overwrite !== '覆盖当前数据') {
    throw biz(4000, '二次确认必须输入"覆盖当前数据"');
  }
  const sess = previewTokens.get(token);
  if (!sess) throw biz(4000, '预览已失效，请重新上传备份文件');
  if (maintenanceLocked) throw biz(4000, '已有恢复任务进行中');

  // 1) 恢复前对当前数据做临时备份（回滚网；保留在 restore-tmp，不进 backups 列表轮转）
  fs.mkdirSync(RESTORE_TMP_DIR, { recursive: true });
  const prePath = path.join(RESTORE_TMP_DIR, `pre-restore-${tsName(new Date())}-${crypto.randomBytes(4).toString('hex')}.zip`);
  try {
    createBackup(prePath, { now: new Date() });
  } catch (e) {
    throw biz(4000, `恢复前临时备份失败，已中止，当前数据未动：${e.message}`);
  }

  maintenanceLocked = true;
  try {
    const out = swapFromZip(sess.zipPath);
    logModel.addOperationLog({
      operatorId: operator.id, operatorName: operator.name,
      actionType: 'restore_confirm', targetType: 'backup', targetId: null,
      detail: { from: sess.zipPath, recordCounts: out.recordCounts, anomalies: out.anomalies }
    });
    return out;
  } catch (e) {
    testHooks.onBeforeSwap = null; // 回滚路径不再触发注入点
    let rollbackError = null;
    try {
      swapFromZip(prePath); // 回滚到恢复前
    } catch (re) { rollbackError = re.message; }
    logModel.addOperationLog({
      operatorId: operator.id, operatorName: operator.name,
      actionType: 'restore_failed', targetType: 'backup',
      detail: { reason: e.message, rollbackError, preRestorePath: prePath, preRestoreKept: true }
    });
    throw biz(4000, `恢复失败：${e.message}；已回滚到恢复前状态${rollbackError ? `；回滚异常：${rollbackError}` : ''}（临时备份已保留）`);
  } finally {
    maintenanceLocked = false;
    previewTokens.delete(token);
    try { fs.rmSync(sess.zipPath, { force: true }); } catch { /* 忽略 */ }
  }
}

// ===== 手动中止/回滚：用 restore-tmp 里最新一份 pre-restore 临时备份还原，保留临时备份并记录原因 =====
export function abortRestore({ operator, reason }) {
  if (!fs.existsSync(RESTORE_TMP_DIR)) throw biz(4000, '没有可回滚的临时备份');
  const candidates = fs.readdirSync(RESTORE_TMP_DIR)
    .filter((f) => f.startsWith('pre-restore-') && f.endsWith('.zip'))
    .map((f) => ({ f, p: path.join(RESTORE_TMP_DIR, f), t: fs.statSync(path.join(RESTORE_TMP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!candidates.length) throw biz(4000, '没有可回滚的临时备份');

  maintenanceLocked = true;
  try {
    const out = swapFromZip(candidates[0].p);
    logModel.addOperationLog({
      operatorId: operator.id, operatorName: operator.name,
      actionType: 'restore_abort', targetType: 'backup',
      detail: { reason: reason || '手动中止恢复', restoredFrom: candidates[0].f }
    });
    return out;
  } finally {
    maintenanceLocked = false;
  }
}

export function restoreStatus() {
  return { maintenance: maintenanceLocked };
}
