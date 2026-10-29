import db from './db.js';

// 代录授权（契约第3、4.3节）
export default {
  create({ bookkeeperId, delegateId, delegateName, startTime, endTime, grantedById, grantedByName }) {
    const info = db.prepare(`
      INSERT INTO delegations (bookkeeper_id, delegate_id, delegate_name, start_time, end_time, granted_by, granted_by_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(bookkeeperId, delegateId, delegateName, startTime, endTime, grantedById ?? null, grantedByName ?? null);
    return this.findById(Number(info.lastInsertRowid));
  },

  findById(id) {
    return db.prepare(`SELECT * FROM delegations WHERE id = ? AND deleted_at IS NULL`).get(id);
  },

  // 全部授权（含历史，倒序），仅科长查看
  listAll() {
    return db.prepare(`SELECT * FROM delegations WHERE deleted_at IS NULL ORDER BY id DESC`).all();
  },

  // 当前仍在有效期内的授权（status=active 且未到期）
  findActiveNow() {
    return db.prepare(
      `SELECT * FROM delegations WHERE status = 'active' AND end_time > datetime('now','localtime') AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`
    ).get();
  },

  // 代录人当前有效授权：未到期 + 记账员在岗 + 代录人未停用（契约第3节有效性定义）
  findActiveForDelegate(delegateId) {
    return db.prepare(`
      SELECT d.*, b.name AS bookkeeper_name
      FROM delegations d
      JOIN users b ON b.id = d.bookkeeper_id AND b.deleted_at IS NULL AND b.status = 'active'
      WHERE d.delegate_id = ?
        AND d.status = 'active'
        AND d.end_time > datetime('now','localtime')
        AND d.deleted_at IS NULL
        AND (SELECT status FROM users WHERE id = d.delegate_id AND deleted_at IS NULL) = 'active'
      ORDER BY d.id DESC LIMIT 1
    `).get(delegateId);
  },

  revokeById(id, revokedBy) {
    db.prepare(`
      UPDATE delegations SET status = 'revoked', revoked_at = datetime('now','localtime'), revoked_by = ?
      WHERE id = ? AND status = 'active'
    `).run(revokedBy, id);
    return this.findById(id);
  },

  // 停用/更换记账员时，把全部 active 授权置 revoked（契约 A10）
  revokeAllActive(revokedBy) {
    const rows = db.prepare(`SELECT id FROM delegations WHERE status = 'active' AND deleted_at IS NULL`).all();
    for (const r of rows) this.revokeById(r.id, revokedBy);
    return rows.length;
  }
};
