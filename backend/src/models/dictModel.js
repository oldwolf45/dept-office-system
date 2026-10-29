import db from './db.js';

const DICT_COLS = `
  id, dict_type AS dictType, label, code, sort_order AS sortOrder,
  status, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
`;

const dictModel = {
  list({ type = '', includeDisabled = false }) {
    const where = [`deleted_at IS NULL`];
    const params = [];
    if (type) { where.push(`dict_type = ?`); params.push(type); }
    if (!includeDisabled) where.push(`status = 'active'`);
    return db.prepare(`
      SELECT ${DICT_COLS} FROM dicts WHERE ${where.join(' AND ')}
      ORDER BY sort_order ASC, id ASC
    `).all(...params);
  },

  findById(id) {
    return db.prepare(`SELECT ${DICT_COLS} FROM dicts WHERE id = ? AND deleted_at IS NULL`).get(id);
  },

  findByLabel(type, label) {
    return db.prepare(
      `SELECT ${DICT_COLS} FROM dicts WHERE dict_type = ? AND label = ? AND deleted_at IS NULL`
    ).get(type, label);
  },

  create({ type, label, code = null, sortOrder = 0, createdBy }) {
    const info = db.prepare(`
      INSERT INTO dicts (dict_type, label, code, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(type, label, code || null, sortOrder, createdBy ?? null);
    return this.findById(Number(info.lastInsertRowid));
  },

  update(id, { label, sortOrder }) {
    const sets = [`updated_at = datetime('now','localtime')`];
    const params = [];
    if (label !== undefined) { sets.unshift(`label = ?`); params.push(label); }
    if (sortOrder !== undefined) { sets.unshift(`sort_order = ?`); params.push(sortOrder); }
    params.push(id);
    db.prepare(`UPDATE dicts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  },

  setStatus(id, status) {
    db.prepare(`UPDATE dicts SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(status, id);
    return this.findById(id);
  },

  // 校验某类型下 label 是否在活动字典中存在（新建工作时用）
  activeLabelExists(type, label) {
    if (!label) return false;
    return !!db.prepare(
      `SELECT 1 FROM dicts WHERE dict_type = ? AND label = ? AND status = 'active' AND deleted_at IS NULL`
    ).get(type, label);
  }
};

export default dictModel;
