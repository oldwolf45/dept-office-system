import db from './db.js';

const settingModel = {
  get(key) {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row ? row.value : null;
  },

  set(key, value, updatedBy = null) {
    db.prepare(`
      INSERT INTO settings (key, value, updated_by, updated_at)
      VALUES (?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).run(key, String(value), updatedBy ?? null);
    return this.get(key);
  },

  stallDays() {
    const v = Number(this.get('stall_days'));
    return Number.isFinite(v) && v > 0 ? v : 7;
  }
};

export default settingModel;
