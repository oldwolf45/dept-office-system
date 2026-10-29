import { ok, fail } from '../middleware/response.js';
import userModel from '../models/userModel.js';
import workModel from '../models/workModel.js';
import dictModel from '../models/dictModel.js';
import logModel from '../models/logModel.js';
import db from '../models/db.js';
import { listAssignableTargets } from '../services/permissionService.js';
import { downScopeIds, canViewWork, isCollaborator, decorateStall, dayKey, mondayKey, sundayKey } from '../services/workService.js';

// GET /api/work/assignable-users  —— A5 验收：按契约 2.2 返回可直接安排工作的人员
export async function assignableUsers(req, res) {
  return ok(res, { list: listAssignableTargets(req.currentUser) });
}

// 工作列表：mine=本人负责+协作者；subordinates=看到底范围（科员返回空）
// S11 补：overdue / dueThisWeek / stalled 筛选（首页概览数字点击进列表，F40）
export async function listWorks(req, res) {
  const me = req.currentUser;
  const scope = String(req.query.scope || 'mine');
  const status = String(req.query.status || '');
  const keyword = String(req.query.keyword || '');
  const overdue = req.query.overdue === '1';
  const dueThisWeek = req.query.dueThisWeek === '1';
  const stalled = req.query.stalled === '1';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Number(req.query.pageSize) || 20);

  let assigneeIds = [];
  if (scope === 'subordinates') {
    // 科员没有下级 → 返回空（契约 §3）
    if (me.role === 1) return ok(res, { list: [], total: 0, page, pageSize });
    assigneeIds = downScopeIds(me);
  } else {
    // mine：负责人是我，或我是协作者
    assigneeIds = [me.id];
  }
  const dates = { today: dayKey(), mon: mondayKey(), sun: sundayKey() };
  const result = workModel.list({ assigneeIds, status, keyword, page, pageSize, overdue, dueThisWeek, ...dates });
  let list = result.list.map(decorateStall);
  if (scope !== 'subordinates') {
    // mine 里要把"我是协作者"的工作也纳入：assignee 可能不是我
    const collabWorks = workModel.listCollaborating(me.id, { status, keyword });
    const extra = collabWorks.filter((w) => !list.some((x) => x.id === w.id));
    list = [...list, ...extra.map(decorateStall)];
  }
  // stalled 实时口径（与首页一致：进行中 且 距上次进度≥stall_days）
  if (stalled) list = list.filter((w) => w.isStalled);
  return ok(res, { list, total: list.length, page, pageSize });
}

// 工作详情：负责人/协作者/看到底上级/本人写过标注
export async function workDetail(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  if (!canViewWork(me, work)) return fail(res, 4030, '无权限查看该工作');
  return ok(res, {
    ...decorateStall(work),
    progress: workModel.listProgress(work.id),
    attachments: workModel.listAttachments(work.id),
    annotations: workModel.listAnnotations(work.id)
  });
}

// 新建工作：本人登记 或 上级指派（PRD 5.3/B11：名称/类别/内容/开始时间/计划完成时间全部必填）
export async function createWork(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (name.length < 2 || name.length > 100) return fail(res, 4000, '工作名称需2-100字');

  const content = String(body.content || '').trim();
  if (!content) return fail(res, 4000, '工作内容必填');
  if (content.length > 5000) return fail(res, 4000, '工作内容不能超过5000字');

  // 时间必填 + 先后关系（兼容 YYYY-MM-DD 与 YYYY-MM-DD HH:mm）
  const startTime = body.startTime ? String(body.startTime).trim() : '';
  const dueTime = body.dueTime ? String(body.dueTime).trim() : '';
  if (!startTime) return fail(res, 4000, '开始时间必填');
  if (!dueTime) return fail(res, 4000, '计划完成时间必填');
  const tsStart = Date.parse(startTime.replace(' ', 'T'));
  const tsDue = Date.parse(dueTime.replace(' ', 'T'));
  if (!Number.isFinite(tsStart) || !Number.isFinite(tsDue)) {
    return fail(res, 4000, '时间格式不合法（建议 YYYY-MM-DD 或 YYYY-MM-DD HH:mm）');
  }
  if (tsDue < tsStart) return fail(res, 4000, '计划完成时间不能早于开始时间');

  let category = String(body.category || '').trim();
  let priority = String(body.priority || '').trim() || '普通';
  const collaboratorIds = Array.isArray(body.collaboratorIds) ? body.collaboratorIds.map(Number) : [];
  for (const cid of collaboratorIds) {
    if (!userModel.findById(cid)) return fail(res, 4000, `协作者(${cid})不存在或已停用`);
  }

  let assigneeId = body.assigneeId ? Number(body.assigneeId) : me.id;
  let sourceId = null;

  if (assigneeId !== me.id) {
    const target = userModel.findById(assigneeId);
    if (!target) return fail(res, 4000, '被指派人不存在或已停用');
    const assignable = listAssignableTargets(me).some((u) => u.id === assigneeId);
    if (!assignable) return fail(res, 4000, '该人员不在您的可指派范围内');
    // 指派：类别服务端强制"上级安排工作"，忽略传入值；来源=指派方（契约 §2.3）
    category = '上级安排工作';
    sourceId = me.id;
  } else if (!category) {
    return fail(res, 4000, '工作类别必填');
  }

  if (!dictModel.activeLabelExists('work_category', category)) {
    return fail(res, 4000, `工作类别"${category}"不存在或已停用`);
  }
  if (!dictModel.activeLabelExists('priority', priority)) {
    return fail(res, 4000, `优先级"${priority}"不存在或已停用`);
  }

  const work = workModel.create({
    name,
    category,
    content,
    startTime,
    dueTime,
    sourceId,
    assigneeId,
    collaboratorIds,
    priority
  });

  if (sourceId) {
    logModel.addOperationLog({
      operatorId: me.id,
      operatorName: me.name,
      actionType: 'assign_work',
      targetType: 'work',
      targetId: work.id,
      detail: { assigneeId, category }
    });
  }
  return ok(res, decorateStall(work), '创建成功');
}

// 修改工作：负责人或协作者；已完成仅解锁后可改；source_id 不可改
export async function updateWork(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  if (work.assigneeId !== me.id && !isCollaborator(me, work)) {
    return fail(res, 4030, '仅负责人或协作者可修改该工作');
  }
  if (work.status === '已完成' && work.isUnlocked !== 1) {
    return fail(res, 4000, '已完成工作需先解锁才能修改');
  }
  if (work.status === '已取消' || work.status === '已改派') {
    return fail(res, 4000, '当前状态的工作不可修改');
  }

  const body = req.body || {};
  // source_id 不可改（契约 §2.3）
  if (body.sourceId !== undefined && Number(body.sourceId) !== Number(work.sourceId ?? -1)) {
    return fail(res, 4000, '工作来源不可修改');
  }

  const fields = {};
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 2 || n.length > 100) return fail(res, 4000, '工作名称需2-100字');
    fields.name = n;
  }
  if (body.content !== undefined) {
    if (String(body.content).length > 5000) return fail(res, 4000, '工作内容不能超过5000字');
    fields.content = String(body.content);
  }
  if (body.category !== undefined) {
    if (!dictModel.activeLabelExists('work_category', body.category)) {
      return fail(res, 4000, `工作类别"${body.category}"不存在或已停用`);
    }
    fields.category = String(body.category).trim();
  }
  if (body.priority !== undefined) {
    if (!dictModel.activeLabelExists('priority', body.priority)) {
      return fail(res, 4000, `优先级"${body.priority}"不存在或已停用`);
    }
    fields.priority = String(body.priority).trim();
  }
  if (body.startTime !== undefined) fields.startTime = body.startTime;
  if (body.dueTime !== undefined) fields.dueTime = body.dueTime;
  if (body.collaboratorIds !== undefined) {
    const ids = Array.isArray(body.collaboratorIds) ? body.collaboratorIds.map(Number) : [];
    for (const cid of ids) {
      if (!userModel.findById(cid)) return fail(res, 4000, `协作者(${cid})不存在或已停用`);
    }
    fields.collaboratorIds = ids;
  }
  return ok(res, decorateStall(workModel.update(work.id, fields)));
}

// 完成：仅负责人，总结必填
export async function completeWork(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  if (work.assigneeId !== me.id) return fail(res, 4030, '仅负责人可完成该工作');
  if (!['未开始', '进行中'].includes(work.status)) {
    return fail(res, 4000, `当前状态(${work.status})不可完成`);
  }
  const summary = String((req.body || {}).summary || '').trim();
  if (!summary) return fail(res, 4000, '完成总结必填');
  const updated = workModel.setStatus(work.id, '已完成', { summary });
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'complete_work', targetType: 'work', targetId: work.id });
  return ok(res, decorateStall(updated));
}

// 取消：仅负责人，原因必填，仅未开始/进行中
export async function cancelWork(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  if (work.assigneeId !== me.id) return fail(res, 4030, '仅负责人可取消该工作');
  if (!['未开始', '进行中'].includes(work.status)) {
    return fail(res, 4000, `当前状态(${work.status})不可取消`);
  }
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return fail(res, 4000, '取消原因必填');
  const updated = workModel.setStatus(work.id, '已取消', { cancelReason: reason });
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'cancel_work', targetType: 'work', targetId: work.id, detail: { reason } });
  return ok(res, decorateStall(updated));
}

// 解锁：科长/副科长，仅已完成，留痕（B14）
export async function unlockWork(req, res) {
  const me = req.currentUser;
  if (me.role !== 3 && me.role !== 2) return fail(res, 4030, '仅科长/副科长可解锁工作');
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  if (work.status !== '已完成') return fail(res, 4000, '仅已完成工作可解锁');
  if (work.isUnlocked === 1) return fail(res, 4000, '该工作已解锁');
  const updated = workModel.setStatus(work.id, '已完成', { isUnlocked: 1 });
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'unlock_work', targetType: 'work', targetId: work.id });
  return ok(res, decorateStall(updated));
}

// 追加进度：负责人/协作者；第一条转进行中；只增不改（契约 §2.4）
export async function addProgress(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  const isOwner = work.assigneeId === me.id;
  const isCollab = isCollaborator(me, work);
  if (!isOwner && !isCollab) return fail(res, 4030, '仅负责人或协作者可追加进度');
  // 完成状态下：仅解锁后可补；已取消/已改派拒
  if (work.status === '已完成' && work.isUnlocked !== 1) {
    return fail(res, 4000, '已完成工作需先解锁才能追加进度');
  }
  if (work.status === '已取消' || work.status === '已改派') {
    return fail(res, 4000, `当前状态(${work.status})不可追加进度`);
  }

  const content = String((req.body || {}).content || '').trim();
  if (!content) return fail(res, 4000, '进度内容必填');

  // 第一条进度：未开始 → 进行中
  if (work.status === '未开始') {
    workModel.setStatus(work.id, '进行中');
  }
  const record = workModel.addProgress({
    workId: work.id,
    authorId: me.id,
    authorType: isOwner ? 'owner' : 'collaborator',
    content
  });
  workModel.touchProgress(work.id);
  const updated = workModel.findById(work.id);
  return ok(res, { ...decorateStall(updated), progressRecord: record });
}

// 改派：科长改派副科长/科员，副科长改派科员；接收人=操作人范围内本科室人员
export async function transferWork(req, res) {
  const me = req.currentUser;
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');

  // 原负责人须在我的"看到底"范围内（科长/副科长才能执行改派）
  if (me.role !== 3 && me.role !== 2) return fail(res, 4030, '仅科长/副科长可改派工作');
  const myDown = downScopeIds(me);
  if (!myDown.includes(work.assigneeId)) return fail(res, 4030, '该工作不在您的改派范围内');

  if (['已完成', '已取消', '已改派'].includes(work.status)) {
    return fail(res, 4000, `当前状态(${work.status})不可改派`);
  }

  const newAssigneeId = Number((req.body || {}).newAssigneeId);
  const reason = String((req.body || {}).reason || '').trim();
  if (!reason) return fail(res, 4000, '改派原因必填');
  if (!newAssigneeId) return fail(res, 4000, '接收人必填');
  if (newAssigneeId === work.assigneeId) return fail(res, 4000, '接收人不能是原负责人');

  // 接收人须在操作人可指派范围内（本科室）
  const assignable = listAssignableTargets(me).some((u) => u.id === newAssigneeId);
  const target = userModel.findById(newAssigneeId);
  if (!target) return fail(res, 4000, '接收人不存在或已停用');
  if (!assignable) return fail(res, 4000, '接收人不在您的可指派范围内');

  // 原记录 → 已改派（进度/附件/标注/总结完整保留）
  workModel.setStatus(work.id, '已改派');
  // 新记录：未开始，复制指定字段，summary 为空
  const fresh = workModel.create({
    name: work.name,
    category: work.category,
    content: work.content,
    startTime: work.startTime,
    dueTime: work.dueTime,
    priority: work.priority,
    sourceId: work.sourceId,
    assigneeId: newAssigneeId,
    collaboratorIds: []
  });
  workModel.addTransfer({
    workId: work.id,
    oldAssigneeId: work.assigneeId,
    newAssigneeId,
    reason,
    operatorId: me.id
  });
  logModel.addOperationLog({
    operatorId: me.id,
    operatorName: me.name,
    actionType: 'transfer_work',
    targetType: 'work',
    targetId: work.id,
    detail: { oldAssigneeId: work.assigneeId, newAssigneeId, reason }
  });
  return ok(res, { original: decorateStall(workModel.findById(work.id)), newWork: decorateStall(fresh) });
}

// 写标注：写标注范围=有下级角色（科员4030）；目标=我看到底的下级工作
export async function createAnnotation(req, res) {
  const me = req.currentUser;
  if (me.role === 1) return fail(res, 4030, '科员无写标注权限');
  const work = workModel.findById(Number(req.params.id));
  if (!work) return fail(res, 4040, '工作不存在');
  // 被标注的必须是我的下级工作（不含本人）
  const descendants = userModel.descendantsIds(me.id);
  if (!descendants.includes(work.assigneeId)) return fail(res, 4030, '只能对下级工作写标注');
  const content = String((req.body || {}).content || '').trim();
  if (!content) return fail(res, 4000, '标注内容必填');
  const record = workModel.addAnnotation({ workId: work.id, authorId: me.id, authorName: me.name, content });
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'add_annotation', targetType: 'work', targetId: work.id });
  // 标注不改变工作状态/负责人/进度
  return ok(res, record);
}

// 回复标注：仅工作负责人，每条一次
export async function replyAnnotation(req, res) {
  const me = req.currentUser;
  const annotation = workModel.findAnnotation(Number(req.params.id));
  if (!annotation) return fail(res, 4040, '标注不存在');
  const work = workModel.findById(annotation.workId);
  if (!work) return fail(res, 4040, '工作不存在');
  if (work.assigneeId !== me.id) return fail(res, 4030, '仅工作负责人可回复标注');
  if (annotation.replyContent) return fail(res, 4000, '该标注已回复，每条标注只能回复一次');
  const content = String((req.body || {}).content || '').trim();
  if (!content) return fail(res, 4000, '回复内容必填');
  db.prepare(`UPDATE annotations SET reply_content = ?, reply_at = datetime('now','localtime') WHERE id = ?`).run(content, annotation.id);
  return ok(res, workModel.findAnnotation(annotation.id));
}

// 协作者选择：同科室 active 人员（登录即可调）
export async function coworkers(req, res) {
  const me = req.currentUser;
  const list = db.prepare(`
    SELECT id, user_no AS userNo, name, role FROM users
    WHERE deleted_at IS NULL AND status = 'active' AND dept_code = ? AND id != ?
    ORDER BY role DESC, id
  `).all(me.deptCode, me.id);
  return ok(res, { list });
}
