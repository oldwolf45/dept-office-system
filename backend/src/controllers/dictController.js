import { ok, fail } from '../middleware/response.js';
import dictModel from '../models/dictModel.js';
import logModel from '../models/logModel.js';

const KNOWN_TYPES = ['work_category', 'priority', 'item_category', 'status_tag'];
const PROTECTED_LABEL = '上级安排工作';

// GET /api/dicts?type=  —— 仅 active，下拉用（登录即可）
export async function listActive(req, res) {
  const type = String(req.query.type || '');
  return ok(res, { list: dictModel.list({ type, includeDisabled: false }) });
}

// GET /api/dicts/manage?type=  —— 含停用，仅科长（路由层 requireLevel(3)）
export async function manageList(req, res) {
  const type = String(req.query.type || '');
  return ok(res, { list: dictModel.list({ type, includeDisabled: true }) });
}

// POST /api/dicts  —— 仅科长；同 type 下 label 唯一
export async function create(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const type = String(body.type || '').trim();
  const label = String(body.label || '').trim();
  if (!KNOWN_TYPES.includes(type)) return fail(res, 4000, `字典类型仅支持: ${KNOWN_TYPES.join('/')}`);
  if (!label) return fail(res, 4000, '标签不能为空');
  if (dictModel.findByLabel(type, label)) return fail(res, 4000, `该类型下标签"${label}"已存在`);
  const created = dictModel.create({
    type,
    label,
    code: body.code ? String(body.code).trim() : null,
    sortOrder: Number(body.sortOrder) || 0,
    createdBy: me.id
  });
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'create_dict', targetType: 'dict', targetId: created.id, detail: { type, label } });
  return ok(res, created, '新增成功');
}

// PUT /api/dicts/:id  —— 仅科长
export async function update(req, res) {
  const body = req.body || {};
  const dict = dictModel.findById(Number(req.params.id));
  if (!dict) return fail(res, 4040, '字典不存在');
  const label = body.label !== undefined ? String(body.label).trim() : undefined;
  if (label !== undefined) {
    if (!label) return fail(res, 4000, '标签不能为空');
    const dup = dictModel.findByLabel(dict.dictType, label);
    if (dup && dup.id !== dict.id) return fail(res, 4000, `该类型下标签"${label}"已存在`);
  }
  const updated = dictModel.update(dict.id, { label, sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined });
  return ok(res, updated);
}

// POST /api/dicts/:id/disable  —— 仅科长；"上级安排工作"禁停
export async function disable(req, res) {
  const me = req.currentUser;
  const dict = dictModel.findById(Number(req.params.id));
  if (!dict) return fail(res, 4040, '字典不存在');
  if (dict.label === PROTECTED_LABEL) {
    return fail(res, 4000, `"${PROTECTED_LABEL}"为指派依赖字典，禁止停用`);
  }
  if (dict.status !== 'active') return fail(res, 4000, '该字典已是停用状态');
  const updated = dictModel.setStatus(dict.id, 'disabled');
  logModel.addOperationLog({ operatorId: me.id, operatorName: me.name, actionType: 'disable_dict', targetType: 'dict', targetId: dict.id });
  return ok(res, updated);
}

// POST /api/dicts/:id/enable
export async function enable(req, res) {
  const dict = dictModel.findById(Number(req.params.id));
  if (!dict) return fail(res, 4040, '字典不存在');
  if (dict.status === 'active') return fail(res, 4000, '该字典已是启用状态');
  return ok(res, dictModel.setStatus(dict.id, 'active'));
}
