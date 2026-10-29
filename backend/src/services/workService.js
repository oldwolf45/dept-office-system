// 工作域公共服务：范围校验、停滞计算、日期工具（契约 §2/§3）
import db from '../models/db.js';
import userModel from '../models/userModel.js';
import workModel from '../models/workModel.js';
import settingModel from '../models/settingModel.js';

// 我能"看到底"的人员 id 集合：本人 + 所有后代；科员只有自己
export function downScopeIds(me) {
  if (me.role === 1) return [me.id];
  return [me.id, ...userModel.descendantsIds(me.id)];
}

// 我能否查看该工作：负责人 / 协作者 / 看到底范围内上级 / 本人写过标注
export function canViewWork(me, work) {
  if (!work) return false;
  if (work.assigneeId === me.id) return true;
  if (workModel.parseCollaborators(work.collaboratorIds).includes(me.id)) return true;
  if (downScopeIds(me).includes(work.assigneeId)) return true;
  const a = db.prepare(
    `SELECT 1 FROM annotations WHERE work_id = ? AND author_id = ? AND deleted_at IS NULL LIMIT 1`
  ).get(work.id, me.id);
  return !!a;
}

// 我是否为该工作的协作者
export function isCollaborator(me, work) {
  return workModel.parseCollaborators(work.collaboratorIds).includes(me.id);
}

// 停滞计算（契约 §2.7，不进表，实时算）：仅"进行中"参与
export function decorateStall(work) {
  const stallDays = settingModel.stallDays();
  let isStalled = false;
  let stalledDays = 0;
  if (work.status === '进行中' && work.lastProgressAt) {
    const ts = Date.parse(String(work.lastProgressAt).replace(' ', 'T'));
    if (Number.isFinite(ts)) {
      stalledDays = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
      if (stalledDays >= stallDays) isStalled = true;
    }
  }
  return { ...work, isStalled, stalledDays, collaborators: workModel.parseCollaborators(work.collaboratorIds) };
}

function pad(n) { return String(n).padStart(2, '0'); }

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 本周一 00:00 对应的 dayKey
export function mondayKey(now = new Date()) {
  const dow = (now.getDay() + 6) % 7; // 0 = 周一
  const m = new Date(now);
  m.setDate(now.getDate() - dow);
  return dayKey(m);
}

export function sundayKey(now = new Date()) {
  const s = new Date(now);
  s.setDate(now.getDate() - ((now.getDay() + 6) % 7) + 6);
  return dayKey(s);
}

export function monthKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}
