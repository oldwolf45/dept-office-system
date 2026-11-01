// A10/A11 线上备份恢复演练（在 api 容器内执行，走真实 HTTP 接口）
// 关键点：恢复必须由 API 进程完成（swapFromZip 在进程内 close/reopen 数据库），
// 所以这里用 fetch 调 /api/admin/*，而不是直接调服务层换文件——
// 另起进程换文件会让运行中的 API 握着被删除的旧 inode，重启前写入全丢。
//
// 用法（容器内无 node_modules 解析路径，必须显式给 NODE_PATH）：
//   docker cp drill-restore.cjs legacy-office-api-1:/tmp/drill-restore.cjs
//   docker exec -e NODE_PATH=/app/node_modules legacy-office-api-1 node /tmp/drill-restore.cjs
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const API = 'http://127.0.0.1:3000/api';
const DBFILE = '/app/data/app.db';
const TABLES = ['material_categories', 'finance_categories', 'plans', 'plan_items', 'purchases',
  'materials', 'material_events', 'issue_records', 'recycle_records', 'disposal_batches',
  'disposal_items', 'module_role_map', 'module_access'];

const TOKEN = jwt.sign({ userId: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });

function snapshot() {
  const db = new DatabaseSync(DBFILE, { readOnly: true });
  const counts = {};
  for (const t of [...TABLES, 'users', 'backup_logs', 'operation_logs']) {
    try {
      // backup_logs / operation_logs 没有 deleted_at 列，按表结构决定是否过滤软删
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      const where = cols.includes('deleted_at') ? ' WHERE deleted_at IS NULL' : '';
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}${where}`).get().n;
    } catch { counts[t] = 'ERR'; }
  }
  db.close();
  return counts;
}

async function call(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(opts.headers || {}) }
  });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) return { status: r.status, body: await r.json() };
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
}

(async () => {
  const log = (...a) => console.log(...a);

  log('=== 基线 ===');
  const before = snapshot();
  log('users=', before.users, 'backup_logs=', before.backup_logs, 'materials=', before.materials);

  log('\n=== 1. 生成备份（POST /admin/backup）===');
  const bk = await call('/admin/backup', { method: 'POST' });
  log('status=', bk.status, 'body=', JSON.stringify(bk.body).slice(0, 400));
  if (bk.body?.code !== 0) { log('备份失败，终止'); process.exit(1); }
  const bkId = bk.body.data?.id ?? bk.body.data?.backupId;
  const bkName = bk.body.data?.name ?? bk.body.data?.fileName;
  log('备份 id=', bkId, 'name=', bkName);

  log('\n=== 2. 下载备份包（GET /admin/backups/:id/download）===');
  const dl = await call(`/admin/backups/${bkId}/download`);
  log('status=', dl.status, 'size=', dl.buf ? dl.buf.length : 'n/a');
  if (dl.status !== 200 || !dl.buf) { log('下载失败，终止'); process.exit(1); }
  fs.writeFileSync('/tmp/drill.zip', dl.buf);

  const midCounts = snapshot();
  log('备份后 backup_logs=', midCounts.backup_logs, '（比基线多 1，说明备份记录已落库）');

  log('\n=== 3. 恢复预览（POST /admin/restore/preview）===');
  const fd = new FormData();
  fd.append('file', new Blob([dl.buf], { type: 'application/zip' }), bkName || 'drill.zip');
  const pv = await call('/admin/restore/preview', { method: 'POST', body: fd });
  log('status=', pv.status);
  const pdata = pv.body?.data || {};
  log('backupTime=', pdata.backupTime, 'systemVersion=', pdata.systemVersion,
      'attachmentCount=', pdata.attachmentCount, 'totalSize=', pdata.totalSize);
  log('清单里材料表记录数示例：materials=', pdata.recordCounts?.materials,
      'plans=', pdata.recordCounts?.plans, 'module_role_map=', pdata.recordCounts?.module_role_map);
  if (pv.body?.code !== 0 || !pdata.previewToken) { log('预览失败，终止'); process.exit(1); }

  log('\n=== 4. 二次确认恢复（POST /admin/restore/confirm）===');
  // 先验证字面量守卫
  const bad = await call('/admin/restore/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: pdata.previewToken, overwrite: '确认' })
  });
  log('错误字面量返回：status=', bad.status, 'code=', bad.body?.code, 'message=', bad.body?.message);

  const rc = await call('/admin/restore/confirm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewToken: pdata.previewToken, overwrite: '覆盖当前数据' })
  });
  log('status=', rc.status, 'body=', JSON.stringify(rc.body).slice(0, 900));
  if (rc.body?.code !== 0) { log('恢复失败'); process.exit(1); }

  const out = rc.body.data || {};
  log('anomalies=', JSON.stringify(out.anomalies), '（空数组=逐表记录数全部对上）');
  log('requireRelogin=', out.requireRelogin);

  log('\n=== 5. 恢复后校验 ===');
  const after = snapshot();
  log('users=', after.users, '（应仍为 14）');
  let diff = 0;
  for (const t of TABLES) {
    if (before[t] !== after[t]) { log(`  !! ${t}: ${before[t]} -> ${after[t]}`); diff++; }
  }
  log('材料模块 13 表前后一致：', diff === 0 ? '是' : `否（${diff} 张表不一致）`);
  log(`backup_logs: 基线 ${before.backup_logs} -> 恢复后 ${after.backup_logs}`
      + '（回到基线说明库文件确实被整体替换过，不是空转）');

  log('\n=== 6. 恢复后接口可用性 ===');
  const me = await call('/auth/me');
  log('/auth/me status=', me.status, 'code=', me.body?.code, 'user=', me.body?.data?.name);
  const info = await call('/system/info');
  log('/system/info status=', info.status, 'code=', info.body?.code);
  const ov = await call('/materials/dashboard/overview');
  log('/materials/dashboard/overview status=', ov.status, 'code=', ov.body?.code);
})();
