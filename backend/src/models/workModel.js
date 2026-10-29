import db from './db.js';

// works 表数据访问层（契约 §2）。行查询 AS 映射成驼峰。
const WORK_COLS = `
  id, name, category, content,
  start_time AS startTime, due_time AS dueTime,
  source_id AS sourceId, assignee_id AS assigneeId,
  collaborator_ids AS collaboratorIds,
  status, priority, summary,
  cancel_reason AS cancelReason, is_unlocked AS isUnlocked,
  last_progress_at AS lastProgressAt,
  created_at AS createdAt, updated_at AS updatedAt
`;

function parseCollaborators(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(Number) : [];
  } catch {
    return [];
  }
}

const workModel = {
  parseCollaborators,

  findById(id) {
    return db.prepare(`SELECT ${WORK_COLS} FROM works WHERE id = ? AND deleted_at IS NULL`).get(id);
  },

  create({ name, category, content, startTime, dueTime, sourceId, assigneeId, collaboratorIds, priority }) {
    const info = db.prepare(`
      INSERT INTO works (name, category, content, start_time, due_time, source_id, assignee_id, collaborator_ids, priority, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '未开始')
    `).run(
      name,
      category || '固定工作',
      content || null,
      startTime || null,
      dueTime || null,
      sourceId ?? null,
      assigneeId,
      collaboratorIds && collaboratorIds.length ? JSON.stringify(collaboratorIds.map(Number)) : null,
      priority || '普通'
    );
    return this.findById(Number(info.lastInsertRowid));
  },

  update(id, fields) {
    const sets = [];
    const params = [];
    if (fields.name !== undefined) { sets.push('name = ?'); params.push(fields.name); }
    if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category); }
    if (fields.content !== undefined) { sets.push('content = ?'); params.push(fields.content); }
    if (fields.startTime !== undefined) { sets.push('start_time = ?'); params.push(fields.startTime || null); }
    if (fields.dueTime !== undefined) { sets.push('due_time = ?'); params.push(fields.dueTime || null); }
    if (fields.priority !== undefined) { sets.push('priority = ?'); params.push(fields.priority); }
    if (fields.collaboratorIds !== undefined) {
      sets.push('collaborator_ids = ?');
      params.push(fields.collaboratorIds.length ? JSON.stringify(fields.collaboratorIds.map(Number)) : null);
    }
    if (!sets.length) return this.findById(id);
    sets.push(`updated_at = datetime('now','localtime')`);
    params.push(id);
    db.prepare(`UPDATE works SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  },

  setStatus(id, status, extra = {}) {
    const sets = [`status = ?`, `updated_at = datetime('now','localtime')`];
    const params = [status];
    if (extra.summary !== undefined) { sets.push('summary = ?'); params.push(extra.summary); }
    if (extra.cancelReason !== undefined) { sets.push('cancel_reason = ?'); params.push(extra.cancelReason); }
    if (extra.isUnlocked !== undefined) { sets.push('is_unlocked = ?'); params.push(extra.isUnlocked); }
    params.push(id);
    db.prepare(`UPDATE works SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  },

  touchProgress(id) {
    db.prepare(`UPDATE works SET last_progress_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE id = ?`).run(id);
    return this.findById(id);
  },

  // 列表查询：ids 为可见工作的 assignee 范围（已解析好的人员 id 集合）
  // 筛选口径与 dashboardController.summary 一致：
  //  overdue=未开始/进行中 且 due_time < 今天；dueThisWeek=未开始/进行中 且 due_time 在本周一~周日
  //  stalled 在 controller 侧 decorateStall 后过滤（实时读 settings.stall_days）
  list({ assigneeIds = [], status = '', keyword = '', page = 1, pageSize = 20, overdue = false, dueThisWeek = false, today = '', mon = '', sun = '' }) {
    const where = [`deleted_at IS NULL`];
    const params = [];
    if (assigneeIds.length) {
      where.push(`assignee_id IN (${assigneeIds.map(() => '?').join(',')})`);
      params.push(...assigneeIds);
    } else {
      where.push(`1 = 0`);
    }
    if (status) { where.push(`status = ?`); params.push(status); }
    if (keyword) { where.push(`(name LIKE ? OR content LIKE ?)`); params.push(`%${keyword}%`, `%${keyword}%`); }
    if (overdue) {
      where.push(`status IN ('未开始','进行中') AND due_time IS NOT NULL AND substr(due_time,1,10) < ?`);
      params.push(today);
    }
    if (dueThisWeek) {
      where.push(`status IN ('未开始','进行中') AND due_time IS NOT NULL AND substr(due_time,1,10) BETWEEN ? AND ?`);
      params.push(mon, sun);
    }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM works WHERE ${where.join(' AND ')}`).get(...params).n;
    const list = db.prepare(`
      SELECT ${WORK_COLS} FROM works WHERE ${where.join(' AND ')}
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  },

  // 我作为协作者参与的工作（collaborator_ids JSON 含我）
  listCollaborating(userId, { status = '', keyword = '' } = {}) {
    const rows = db.prepare(`
      SELECT ${WORK_COLS} FROM works
      WHERE deleted_at IS NULL AND collaborator_ids IS NOT NULL
    `).all();
    return rows.filter((w) => {
      if (!this.parseCollaborators(w.collaboratorIds).includes(userId)) return false;
      if (status && w.status !== status) return false;
      if (keyword && !(w.name.includes(keyword) || (w.content || '').includes(keyword))) return false;
      return true;
    });
  },

  // ===== 进度（只增不删）=====
  addProgress({ workId, authorId, authorType, content }) {
    const info = db.prepare(`
      INSERT INTO progress_records (work_id, author_id, author_type, content)
      VALUES (?, ?, ?, ?)
    `).run(workId, authorId, authorType, content);
    return db.prepare(`
      SELECT id, work_id AS workId, author_id AS authorId, author_type AS authorType,
             content, created_at AS createdAt
      FROM progress_records WHERE id = ?
    `).get(Number(info.lastInsertRowid));
  },

  listProgress(workId) {
    return db.prepare(`
      SELECT p.id, p.work_id AS workId, p.author_id AS authorId, p.author_type AS authorType,
             p.content, p.created_at AS createdAt, u.name AS authorName
      FROM progress_records p
      LEFT JOIN users u ON u.id = p.author_id AND u.deleted_at IS NULL
      WHERE p.work_id = ? AND p.deleted_at IS NULL
      ORDER BY p.id ASC
    `).all(workId);
  },

  findProgress(id) {
    return db.prepare(`SELECT * FROM progress_records WHERE id = ? AND deleted_at IS NULL`).get(id);
  },

  // ===== 附件 =====
  addAttachment({ workId, progressId, uploaderId, originalName, storedName, mimeType, size }) {
    const info = db.prepare(`
      INSERT INTO attachments (work_id, progress_id, uploader_id, original_name, stored_name, mime_type, size)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(workId, progressId ?? null, uploaderId, originalName, storedName, mimeType ?? null, size ?? null);
    return this.findAttachment(Number(info.lastInsertRowid));
  },

  findAttachment(id) {
    return db.prepare(`
      SELECT id, work_id AS workId, progress_id AS progressId, uploader_id AS uploaderId,
             original_name AS originalName, stored_name AS storedName, mime_type AS mimeType,
             size, created_at AS createdAt
      FROM attachments WHERE id = ? AND deleted_at IS NULL
    `).get(id);
  },

  listAttachments(workId) {
    return db.prepare(`
      SELECT a.id, a.work_id AS workId, a.progress_id AS progressId, a.uploader_id AS uploaderId,
             a.original_name AS originalName, a.stored_name AS storedName, a.mime_type AS mimeType,
             a.size, a.created_at AS createdAt, u.name AS uploaderName
      FROM attachments a
      LEFT JOIN users u ON u.id = a.uploader_id AND u.deleted_at IS NULL
      WHERE a.work_id = ? AND a.deleted_at IS NULL
      ORDER BY a.id ASC
    `).all(workId);
  },

  softDeleteAttachment(id) {
    db.prepare(`UPDATE attachments SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(id);
  },

  // ===== 标注 =====
  addAnnotation({ workId, authorId, authorName, content }) {
    const info = db.prepare(`
      INSERT INTO annotations (work_id, author_id, author_name, content)
      VALUES (?, ?, ?, ?)
    `).run(workId, authorId, authorName, content);
    return this.findAnnotation(Number(info.lastInsertRowid));
  },

  findAnnotation(id) {
    return db.prepare(`
      SELECT id, work_id AS workId, author_id AS authorId, author_name AS authorName,
             content, reply_content AS replyContent, reply_at AS replyAt, created_at AS createdAt
      FROM annotations WHERE id = ? AND deleted_at IS NULL
    `).get(id);
  },

  listAnnotations(workId) {
    return db.prepare(`
      SELECT id, work_id AS workId, author_id AS authorId, author_name AS authorName,
             content, reply_content AS replyContent, reply_at AS replyAt, created_at AS createdAt
      FROM annotations WHERE work_id = ? AND deleted_at IS NULL ORDER BY id ASC
    `).all(workId);
  },

  countUnrepliedForAssignee(assigneeId) {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM annotations a
      JOIN works w ON w.id = a.work_id AND w.deleted_at IS NULL
      WHERE w.assignee_id = ? AND a.reply_content IS NULL AND a.deleted_at IS NULL
    `).get(assigneeId).n;
  },

  // ===== 改派 =====
  addTransfer({ workId, oldAssigneeId, newAssigneeId, reason, operatorId }) {
    db.prepare(`
      INSERT INTO work_transfers (work_id, old_assignee_id, new_assignee_id, reason, operator_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(workId, oldAssigneeId, newAssigneeId, reason, operatorId);
  }
};

export default workModel;
