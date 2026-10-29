import db from './db.js';

// users 表数据访问层（契约第3节）。行查询统一用 AS 映射成驼峰。
const COLS = `id, user_no AS userNo, name, role, dept_code AS deptCode, dept_name AS deptName,
  parent_id AS parentId, status, is_bookkeeper AS isBookkeeper,
  must_change_password AS mustChangePassword, password_hash AS passwordHash,
  created_at AS createdAt`;

export default {
  findById(id) {
    return db.prepare(`SELECT ${COLS} FROM users WHERE id = ? AND deleted_at IS NULL`).get(id);
  },

  findByUserNo(userNo) {
    return db.prepare(`SELECT ${COLS} FROM users WHERE user_no = ? AND deleted_at IS NULL`).get(userNo);
  },

  findBookkeeper() {
    return db.prepare(
      `SELECT ${COLS} FROM users WHERE is_bookkeeper = 1 AND status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`
    ).get();
  },

  create({ userNo, name, role, deptCode, deptName, parentId, passwordHash }) {
    const info = db.prepare(`
      INSERT INTO users (user_no, name, role, dept_code, dept_name, parent_id, status, is_bookkeeper, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, 1)
    `).run(userNo, name, role, deptCode || '01', deptName || '综合科', parentId ?? null, passwordHash);
    return this.findById(Number(info.lastInsertRowid));
  },

  // 从 rootId 出发逐层向下收集所有后代（含间接下级），不含 rootId 本身
  descendantsIds(rootId) {
    const out = [];
    let frontier = [rootId];
    while (frontier.length) {
      const rows = db.prepare(
        `SELECT id FROM users WHERE parent_id IN (${frontier.map(() => '?').join(',')}) AND deleted_at IS NULL`
      ).all(...frontier);
      if (!rows.length) break;
      out.push(...rows.map((r) => r.id));
      frontier = rows.map((r) => r.id);
    }
    return out;
  },

  setStatus(id, status) {
    db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(status, id);
    return this.findById(id);
  },

  setBookkeeper(id, flag) {
    db.prepare(`UPDATE users SET is_bookkeeper = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(flag, id);
  },

  updatePassword(id, passwordHash) {
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now','localtime') WHERE id = ?`).run(passwordHash, id);
  },

  // 分页查询：限定可见 id 集合 + 关键字
  search({ ids, keyword = '', page = 1, pageSize = 20 }) {
    const where = [`id IN (${ids.map(() => '?').join(',')})`, `deleted_at IS NULL`];
    const params = [...ids];
    if (keyword) {
      where.push(`(name LIKE ? OR user_no LIKE ?)`);
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where.join(' AND ')}`).get(...params).n;
    const list = db.prepare(`
      SELECT id, user_no AS userNo, name, role, dept_code AS deptCode, dept_name AS deptName,
             parent_id AS parentId, status, is_bookkeeper AS isBookkeeper, created_at AS createdAt
      FROM users WHERE ${where.join(' AND ')} ORDER BY id LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  }
};
