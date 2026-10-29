import db from './db.js';

// S6 工作总结存档（契约 §2.1）：只增不删，无物理删除接口
const COLS = `
  id, dept_code AS deptCode, period_start AS periodStart, period_end AS periodEnd,
  content_type AS contentType, group_key AS groupKey, version, version_type AS versionType,
  content, word_count AS wordCount, status, is_preferred AS isPreferred, is_enabled AS isEnabled,
  created_by AS createdBy, created_by_name AS createdByName, created_at AS createdAt
`;

function parseJsonMaybe(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    snapshot: parseJsonMaybe(row.snapshotRaw),
    referencedSamples: parseJsonMaybe(row.referencedSamplesRaw),
    modelInfo: parseJsonMaybe(row.modelInfoRaw),
    validation: parseJsonMaybe(row.validationRaw)
  };
}

const summaryModel = {
  hydrate,

  // 组内下一个版本号：v1/v2/v3…
  nextVersion(groupKey) {
    const row = db.prepare(
      `SELECT version FROM summary_archives WHERE group_key = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`
    ).get(groupKey);
    let n = 0;
    if (row) {
      const m = /^v(\d+)$/.exec(String(row.version));
      n = m ? Number(m[1]) : 0;
    }
    return `v${n + 1}`;
  },

  create({
    deptCode, periodStart, periodEnd, contentType, groupKey, version, versionType,
    content, status, isPreferred = 0, isEnabled = 0,
    snapshot, referencedSamples, modelInfo, validation, createdBy, createdByName
  }) {
    const wordCount = String(content || '').replace(/\s/g, '').length;
    const info = db.prepare(`
      INSERT INTO summary_archives
        (dept_code, period_start, period_end, content_type, group_key, version, version_type,
         content, word_count, status, is_preferred, is_enabled,
         snapshot, referenced_samples, model_info, validation, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deptCode, periodStart ?? null, periodEnd ?? null, contentType, groupKey, version, versionType,
      content, wordCount, status, isPreferred, isEnabled,
      snapshot ? JSON.stringify(snapshot) : null,
      referencedSamples ? JSON.stringify(referencedSamples) : null,
      modelInfo ? JSON.stringify(modelInfo) : null,
      validation ? JSON.stringify(validation) : null,
      createdBy ?? null, createdByName ?? null
    );
    return this.findById(Number(info.lastInsertRowid));
  },

  findRawById(id) {
    return db.prepare(`
      SELECT ${COLS}, snapshot AS snapshotRaw, referenced_samples AS referencedSamplesRaw,
             model_info AS modelInfoRaw, validation AS validationRaw
      FROM summary_archives WHERE id = ? AND deleted_at IS NULL
    `).get(id);
  },

  findById(id) {
    return hydrate(this.findRawById(id));
  },

  update(id, fields) {
    const sets = [];
    const params = [];
    if (fields.status !== undefined) { sets.push('status = ?'); params.push(fields.status); }
    if (fields.isPreferred !== undefined) { sets.push('is_preferred = ?'); params.push(fields.isPreferred); }
    if (fields.isEnabled !== undefined) { sets.push('is_enabled = ?'); params.push(fields.isEnabled); }
    if (!sets.length) return this.findById(id);
    params.push(id);
    db.prepare(`UPDATE summary_archives SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.findById(id);
  },

  // 版本列表：creatorIds=可见生成人集合（科员仅本人，上级=看到底范围）
  list({ creatorIds = [], groupKey = '', status = '', page = 1, pageSize = 20 }) {
    const where = [`deleted_at IS NULL`];
    const params = [];
    if (creatorIds.length) {
      where.push(`created_by IN (${creatorIds.map(() => '?').join(',')})`);
      params.push(...creatorIds);
    } else {
      where.push('1 = 0');
    }
    if (groupKey) { where.push('group_key = ?'); params.push(groupKey); }
    if (status) { where.push('status = ?'); params.push(status); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM summary_archives WHERE ${where.join(' AND ')}`).get(...params).n;
    const list = db.prepare(`
      SELECT ${COLS} FROM summary_archives WHERE ${where.join(' AND ')}
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  },

  // 经验库检索：本科室 + contentType 同；
  // 定稿启用样例 OR 月度报表汇总说明候选（is_sample_candidate=1，D34 放宽）
  searchSamples({ deptCode, contentType, limit = 5 }) {
    return db.prepare(`
      SELECT ${COLS}, validation AS validationRaw FROM summary_archives
      WHERE dept_code = ? AND content_type = ?
        AND ((status = 'final' AND is_enabled = 1) OR is_sample_candidate = 1)
        AND deleted_at IS NULL
      ORDER BY is_preferred DESC, id DESC
      LIMIT ?
    `).all(deptCode, contentType, limit).map(hydrate);
  },

  // 经验库页面：本科室定稿样例 + 月度报表汇总说明候选（D34，含停用，带开关/优选标记）
  listSamples({ deptCode, contentType = '', limit = 50 }) {
    const where = [`dept_code = ?`, `(status = 'final' OR is_sample_candidate = 1)`, `deleted_at IS NULL`];
    const params = [deptCode];
    if (contentType) { where.push(`content_type = ?`); params.push(contentType); }
    return db.prepare(`
      SELECT ${COLS} FROM summary_archives WHERE ${where.join(' AND ')}
      ORDER BY is_preferred DESC, id DESC LIMIT ?
    `).all(...params, limit);
  }
};

export default summaryModel;
