// S11 未读提醒（契约 §1.1，PRD 3.4）：
// 未读 = 业务侧新事件存在，但 notice_reads 无对应已读记录；POST 标记已读幂等。
// 类型：annotation（标注待回复）/ assigned（被指派新工作）/ approval（待确认账目）
// 历史曾用 accountingApproval，读取/写入均兼容旧字面量，统一输出 approval。
import db from '../models/db.js';

const VALID_TYPES = new Set(['annotation', 'assigned', 'approval']);
// 兼容旧前端/旧数据里的 accountingApproval → 归一化为 approval
const TYPE_ALIAS = { accountingApproval: 'approval' };

export function normalizeType(type) {
  const t = String(type || '');
  return TYPE_ALIAS[t] || (VALID_TYPES.has(t) ? t : null);
}

export function unreadCountsFor(userId, deptCode, canConfirm) {
  const annotation = db.prepare(`
    SELECT COUNT(*) AS n FROM annotations a
    JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
    WHERE w.assignee_id = ? AND a.reply_content IS NULL AND a.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.user_id=? AND nr.type='annotation' AND nr.ref_id=a.id)
  `).get(userId, userId).n;

  const assigned = db.prepare(`
    SELECT COUNT(*) AS n FROM works w
    WHERE w.assignee_id = ? AND w.source_id IS NOT NULL AND w.status = '未开始' AND w.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.user_id=? AND nr.type='assigned' AND nr.ref_id=w.id)
  `).get(userId, userId).n;

  let approval = 0;
  if (canConfirm) {
    approval = db.prepare(`
      SELECT COUNT(*) AS n FROM accounting_approvals ap
      WHERE ap.dept_code = ? AND ap.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM notice_reads nr WHERE nr.user_id=? AND nr.type='approval' AND nr.ref_id=ap.id)
    `).get(deptCode, userId).n;
  }
  return { annotation, assigned, approval };
}

export function markNoticeRead(userId, type, refId) {
  const t = normalizeType(type);
  if (!t) return false;
  db.prepare(`
    INSERT OR IGNORE INTO notice_reads (user_id, type, ref_id) VALUES (?, ?, ?)
  `).run(userId, t, Number(refId));
  return true;
}

export { VALID_TYPES };
