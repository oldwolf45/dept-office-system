import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// node:sqlite 是实验性内置模块，用运行时 require 加载，
// 避免 Vite/vitest 静态解析时把它当成 npm 包。
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 数据目录：本地默认 backend/data；容器内由环境变量传入 /app/data；测试时由 setup.js 指向临时目录
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const dbFile = path.join(DATA_DIR, 'app.db');
let conn = new DatabaseSync(dbFile);
conn.exec('PRAGMA journal_mode = WAL');

// 所有 model 通过这个 Proxy 访问"当前"连接。S12 数据恢复整体替换 db 文件后，
// 只需 close + 重建 conn，各处 db.prepare(...) 自动指向新库，无需改各 model。
const db = new Proxy({}, {
  get(_target, prop) {
    const v = conn[prop];
    return typeof v === 'function' ? v.bind(conn) : v;
  }
});

export { DATA_DIR };

// 发行模式开关（契约 §1.1）：DISTRIBUTION_MODE=1 时不写任何种子账号，
// 由 /api/bootstrap/admin 引导首个管理员；默认关闭=正式模式行为逐字节不变。
// 本仓库不含 seed-data.js，全新部署分支（DISTRIBUTION_MODE=1）绝不 import。
export const DISTRIBUTION_MODE = process.env.DISTRIBUTION_MODE === '1';

// ============ DDL（幂等；启动时跑一次；S12 恢复换库后 reopenDatabase 再跑一次）============
function runSchema() {
  // S1 users 表结构升级：缺 user_no 列说明是 S1 旧骨架表（app.db 无真实数据），直接重建
  const existingCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  if (existingCols.length && !existingCols.includes('user_no')) {
    db.exec('DROP TABLE users');
  }

  // ============ S2 数据模型（契约第3节，全部带 deleted_at 软删除）============
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_no TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role INTEGER NOT NULL CHECK(role BETWEEN 1 AND 5),
    dept_code TEXT NOT NULL DEFAULT '01',
    dept_name TEXT NOT NULL DEFAULT '综合科',
    parent_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
    is_bookkeeper INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_no TEXT,
    user_name TEXT,
    ip TEXT,
    user_agent TEXT,
    status TEXT NOT NULL CHECK(status IN ('success','fail')),
    fail_reason TEXT,
    abnormal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_id INTEGER,
    operator_name TEXT,
    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS delegations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bookkeeper_id INTEGER NOT NULL,
    delegate_id INTEGER NOT NULL,
    delegate_name TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    granted_by INTEGER,
    granted_by_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
    revoked_at TEXT,
    revoked_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    content TEXT,
    start_time TEXT,
    due_time TEXT,
    source_id INTEGER,
    assignee_id INTEGER,
    collaborator_ids TEXT,
    status TEXT NOT NULL DEFAULT '未开始',
    priority TEXT NOT NULL DEFAULT '普通',
    summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS work_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER,
    old_assignee_id INTEGER,
    new_assignee_id INTEGER,
    reason TEXT,
    operator_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS dicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dict_type TEXT NOT NULL,
    label TEXT NOT NULL,
    code TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS progress_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    author_type TEXT NOT NULL CHECK(author_type IN ('owner','collaborator')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL,
    progress_id INTEGER,
    uploader_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    author_name TEXT,
    content TEXT NOT NULL,
    reply_content TEXT,
    reply_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- S6 工作总结存档（契约 §2.1）：不可物理删除，只有 deleted_at 软删占位
  CREATE TABLE IF NOT EXISTS summary_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    content_type TEXT NOT NULL DEFAULT 'work',
    group_key TEXT NOT NULL,
    version TEXT NOT NULL,
    version_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final','rejected')),
    is_preferred INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 0,
    snapshot TEXT,
    referenced_samples TEXT,
    model_info TEXT,
    validation TEXT,
    created_by INTEGER,
    created_by_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_summary_group ON summary_archives(group_key, id);

  -- S11 未读提醒（契约 §1.1）：未读=业务侧存在但本表无记录；已读幂等
  CREATE TABLE IF NOT EXISTS notice_reads (
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    read_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, type, ref_id)
  );

  -- S12 备份记录（契约 §2.1）
  CREATE TABLE IF NOT EXISTS backup_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    sha256 TEXT,
    type TEXT NOT NULL CHECK(type IN ('manual','auto')),
    status TEXT NOT NULL CHECK(status IN ('success','failed')),
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    backup_time TEXT,
    record_counts TEXT,
    attachment_count INTEGER,
    total_size INTEGER,
    schema_version INTEGER
  );
  `);

  // 旧库 delegations 表补列（幂等迁移）
  const delegCols = db.prepare(`PRAGMA table_info(delegations)`).all().map((c) => c.name);
  if (delegCols.length && !delegCols.includes('granted_by')) {
    db.exec(`ALTER TABLE delegations ADD COLUMN granted_by INTEGER`);
    db.exec(`ALTER TABLE delegations ADD COLUMN granted_by_name TEXT`);
  }

  // S4 works 表幂等补列（契约 §2.1）
  const worksCols = db.prepare(`PRAGMA table_info(works)`).all().map((c) => c.name);
  if (worksCols.length) {
    if (!worksCols.includes('cancel_reason')) db.exec(`ALTER TABLE works ADD COLUMN cancel_reason TEXT`);
    if (!worksCols.includes('is_unlocked')) db.exec(`ALTER TABLE works ADD COLUMN is_unlocked INTEGER NOT NULL DEFAULT 0`);
    if (!worksCols.includes('last_progress_at')) db.exec(`ALTER TABLE works ADD COLUMN last_progress_at TEXT`);
  }

  // ============ S8+S9+S10 记账域建表（契约 §3/§4/§5）============
  db.exec(`
  CREATE TABLE IF NOT EXISTS material_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT,
    min_stock INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS material_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    planned_qty INTEGER NOT NULL DEFAULT 0,
    reference_price REAL NOT NULL DEFAULT 0,
    planned_amount REAL NOT NULL DEFAULT 0,
    is_append INTEGER NOT NULL DEFAULT 0,
    append_note TEXT,
    append_at TEXT,
    append_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS material_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT NOT NULL UNIQUE,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    plan_id INTEGER,
    qty INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    receipt_date TEXT NOT NULL,
    handler TEXT,
    voucher TEXT,
    over_plan INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal','void')),
    void_reason TEXT,
    void_at TEXT,
    void_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS material_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL,
    total_qty INTEGER NOT NULL,
    remaining_qty INTEGER NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    received_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS material_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_no TEXT NOT NULL UNIQUE,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    user_id INTEGER,
    qty INTEGER NOT NULL,
    issue_date TEXT NOT NULL,
    handler TEXT,
    batch_alloc TEXT,
    status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal','void')),
    void_reason TEXT,
    void_at TEXT,
    void_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS stocktakings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','confirmed','void')),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    confirmed_by INTEGER,
    confirmed_at TEXT,
    void_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS stocktaking_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taking_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    book_qty INTEGER NOT NULL DEFAULT 0,
    actual_qty INTEGER,
    diff INTEGER,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS accounting_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('receipt','issue','expense')),
    target_id INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('edit','void')),
    changes TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    requested_by INTEGER,
    requested_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    confirmed_by INTEGER,
    confirmed_at TEXT,
    confirm_note TEXT
  );

  CREATE TABLE IF NOT EXISTS fund_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    item TEXT NOT NULL,
    planned_amount REAL NOT NULL DEFAULT 0,
    is_append INTEGER NOT NULL DEFAULT 0,
    append_note TEXT,
    append_at TEXT,
    append_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS fund_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_no TEXT NOT NULL UNIQUE,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    item TEXT NOT NULL,
    amount REAL NOT NULL,
    payee TEXT,
    expense_date TEXT NOT NULL,
    handler TEXT,
    voucher TEXT,
    plan_id INTEGER,
    settle_status TEXT NOT NULL DEFAULT '挂账' CHECK(settle_status IN ('计划内','挂账','部分销账','已结清')),
    over_plan INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal','void')),
    void_reason TEXT,
    void_at TEXT,
    void_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS fund_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id INTEGER NOT NULL,
    plan_id INTEGER,
    settle_amount REAL NOT NULL,
    diff_reason TEXT,
    settled_by INTEGER,
    settled_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS monthly_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dept_code TEXT NOT NULL,
    month TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK(report_type IN ('material','fund','ledger','work','summary')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','archived')),
    data_json TEXT,
    generated_by INTEGER,
    generated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    summary_text TEXT,
    summary_updated_by INTEGER,
    summary_updated_at TEXT,
    is_sample_candidate INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 1,
    UNIQUE(dept_code, month, report_type)
  );
  `);

  // S6 经验库候选标记列（D34：月度报表汇总说明进检索池）幂等补列
  const saCols = db.prepare(`PRAGMA table_info(summary_archives)`).all().map((c) => c.name);
  if (saCols.length && !saCols.includes('is_sample_candidate')) {
    db.exec(`ALTER TABLE summary_archives ADD COLUMN is_sample_candidate INTEGER NOT NULL DEFAULT 0`);
  }
}

runSchema();

// ============ 种子账号（仅正式模式写入；全新部署模式 0 账号待引导）============
// 正式模式（默认）：动态 import 种子模块写入，行为与改造前逐字节一致；
// 发行模式：不 import 不写种子，0 账号待引导。
if (!DISTRIBUTION_MODE) {
  const seed = await import('./seed-data.js');
  seed.seedTestAccounts(db);
}

// ============ S3 字典 bootstrap（空库一次性预置，契约 §1）============
const dictCount = db.prepare(`SELECT COUNT(*) AS n FROM dicts`).get().n;
if (dictCount === 0) {
  const insertDict = db.prepare(`INSERT INTO dicts (dict_type, label, code, sort_order) VALUES (?, ?, ?, ?)`);
  insertDict.run('work_category', '固定工作', 'fixed', 1);
  insertDict.run('work_category', '协作工作', 'collab', 2);
  insertDict.run('work_category', '上级安排工作', 'assigned', 3);
  insertDict.run('priority', '普通', 'normal', 1);
  insertDict.run('priority', '重要', 'important', 2);
  insertDict.run('priority', '紧急', 'urgent', 3);
}

// ============ 停滞阈值 settings 初始化（默认 7 天，契约 §2.7）============
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('stall_days', '7')`).run();

// S7 单位名称（封面/Word/PPT 用，契约 §3：配置驱动不写死）
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('company_name', 'XX单位')`).run();

// 系统名（登录页/标题渲染，契约 §1.3；默认值=正式行为不变，company_name 语义不动）
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('system_name', '科室协同办公系统')`).run();

// 正式模式账号树——正式模式才写入
if (!DISTRIBUTION_MODE) {
  const seed = await import('./seed-data.js');
  seed.seedRealTree(db);
}

// ============ S12 备份恢复：连接替换 ============
export function closeDatabase() {
  try { conn.close(); } catch { /* 已关闭 */ }
}

// 备份前合并 WAL，保证 app.db 单文件一致
export function checkpointWal() {
  try { conn.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* 忽略 */ }
}

// 恢复换库后调用：重新打开新 app.db 并重跑幂等 DDL
export function reopenDatabase() {
  closeDatabase();
  conn = new DatabaseSync(dbFile);
  conn.exec('PRAGMA journal_mode = WAL');
  runSchema();
  return db;
}

export default db;
