import { ok, fail } from '../middleware/response.js';
import summaryModel from '../models/summaryModel.js';
import settingModel from '../models/settingModel.js';
import logModel from '../models/logModel.js';
import { buildSnapshot } from '../services/statsService.js';
import { callMiniMax } from '../services/aiService.js';
import { downScopeIds } from '../services/workService.js';

const CONTENT_TYPES = ['work', 'accounting', 'both'];

// ============ 数字校验（契约 §2.2：模型只组织语言不计算）============
// 允许出现的数字集合：快照里所有数字 + 完成率百分比写法 + 期间里的日期数字
export function collectAllowedNumbers(snapshot) {
  const set = new Set();
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      set.add(String(v));
      set.add(String(Math.round(v)));
    } else if (typeof v === 'string') {
      const m = v.match(/\d+(?:\.\d+)?/g);
      if (m) m.forEach((x) => set.add(x));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(snapshot?.stats);
  walk(snapshot?.period);
  walk(snapshot?.deptCode);
  walk(snapshot?.scopeDesc);
  const rate = snapshot?.stats?.completionRate;
  if (typeof rate === 'number') {
    set.add(String(Math.round(rate * 100)));        // 整数百分，如 86
    set.add(String(Math.round(rate * 1000) / 10));   // 一位小数百分，如 85.7
  }
  return set;
}

// 输出文本中出现、但不在快照数字集合内的数字 → mismatch 列表（去重保序）
export function validateNumbers(content, allowedSet) {
  const found = String(content || '').match(/\d+(?:\.\d+)?/g) || [];
  const mismatches = [];
  for (const n of found) {
    if (!allowedSet.has(n) && !mismatches.includes(n)) mismatches.push(n);
  }
  return mismatches;
}

// ============ 本地模板稿（失败/超时回退，数字全部来自快照）============
export function buildTemplateDraft(snapshot) {
  const s = snapshot.stats;
  const ratePct = Math.round((s.completionRate || 0) * 100);
  const catText = (s.categoryDistribution || []).map((c) => `${c.category}${c.count}项`).join('、') || '无';
  return [
    `${snapshot.deptCode || ''}科室工作总结（${snapshot.period.start || '未限定'} 至 ${snapshot.period.end || '未限定'}）`,
    '',
    '一、本期主要工作与完成情况',
    `本期共安排工作${s.totalWork}项，其中已完成${s.completed}项，进行中${s.inProgress}项，未开始${s.notStarted}项，完成率${ratePct}%，逾期${s.overdue}项。`,
    `按工作类别分布：${catText}。`,
    '',
    '二、存在问题',
    s.overdue > 0
      ? `本期存在逾期工作${s.overdue}项，需在下期重点盯办，逐项明确完成时限。`
      : '本期无逾期工作，整体推进正常。',
    '',
    '三、下期安排',
    `继续推进进行中${s.inProgress}项工作，督促未开始${s.notStarted}项工作按期启动，确保各项工作有序收尾。`
  ].join('\n');
}

// ============ 提示词（快照数字 + 引用样例结构语气，禁止旧数字）============
function buildPrompt(snapshot, samples) {
  const s = snapshot.stats;
  const ratePct = Math.round((s.completionRate || 0) * 100);
  const catText = (s.categoryDistribution || []).map((c) => `${c.category}${c.count}项`).join('、');
  const system = '你是机关单位工作总结撰写助手。只根据给定数字组织语言，禁止自行计算，禁止编造工作、金额和人员，禁止把参考样例中的旧数字带进本期。';
  const userParts = [
    `本期期间：${snapshot.period.start || '未限定'} 至 ${snapshot.period.end || '未限定'}。`,
    `本期唯一可用数字（必须严格使用，不得改动）：应完成工作${s.totalWork}项，其中已完成${s.completed}项、进行中${s.inProgress}项、未开始${s.notStarted}项，完成率${ratePct}%，逾期${s.overdue}项；类别分布：${catText || '无'}。`,
    samples.length
      ? `以下样例仅供参考结构、语气和常用表述，严禁复制其中任何数字：\n` +
        samples.map((x, i) => `【样例${i + 1}】\n${x.content}`).join('\n---\n')
      : '本次无参考样例。',
    '请按"本期主要工作/完成情况/存在问题/下期安排"四部分输出中文总结正文，400-700字，不要输出任何解释性文字。'
  ];
  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') }
  ];
}

// 可见范围：科员仅 created_by=本人；上级=本人+看到到底范围
function visibleCreatorIds(me) {
  if (me.role === 1) return [me.id];
  return downScopeIds(me);
}

function canViewArchive(me, archive) {
  return visibleCreatorIds(me).includes(archive.createdBy);
}

// 把正文按"一、二、三"小节拆开，供 PPT 分页用
export function splitSections(content) {
  const out = { main: '', issues: '', next: '' };
  const lines = String(content || '').split('\n');
  let cur = 'main';
  for (const line of lines) {
    if (/^[二].*存在问题/.test(line) || /^二、/.test(line)) cur = 'issues';
    else if (/^[三].*下期/.test(line) || /^三、/.test(line)) cur = 'next';
    out[cur] += line + '\n';
  }
  out.main = out.main.trim();
  out.issues = out.issues.trim();
  out.next = out.next.trim();
  return out;
}

// ============ 接口 ============

// POST /api/summaries/generate {personScope,startTime,endTime,contentType}
export async function generate(req, res) {
  const me = req.currentUser;
  const body = req.body || {};
  const personScope = String(body.personScope || 'mine');
  const contentType = CONTENT_TYPES.includes(body.contentType) ? body.contentType : 'work';
  const startDate = String(body.startTime || '').slice(0, 10) || '';
  const endDate = String(body.endTime || '').slice(0, 10) || '';

  const snapshot = buildSnapshot(me, { startDate, endDate, personScope, personId: body.personId, contentType });
  if (snapshot.error) return fail(res, snapshot.error, snapshot.message);

  const groupKey = `${me.deptCode}|${startDate}|${endDate}|${contentType}`;
  const referencedSamples = summaryModel.searchSamples({ deptCode: me.deptCode, contentType, limit: 5 });

  const ai = await callMiniMax(buildPrompt(snapshot, referencedSamples));

  let content;
  let versionType;
  let usedFallback = false;
  let modelInfo;
  if (ai.ok) {
    content = ai.content;
    versionType = '初稿';
    modelInfo = { model: ai.model, durationMs: ai.durationMs, tokens: ai.tokens };
  } else {
    content = buildTemplateDraft(snapshot);
    versionType = '模板稿';
    usedFallback = true;
    modelInfo = { model: ai.model || null, durationMs: ai.durationMs, tokens: ai.tokens ?? null, error: ai.error };
  }

  const allowed = collectAllowedNumbers(snapshot);
  const mismatches = validateNumbers(content, allowed);
  const validation = {
    ok: mismatches.length === 0,
    mismatches,
    usedFallback,
    fallbackReason: usedFallback ? ai.error : null
  };

  const version = summaryModel.nextVersion(groupKey);
  const archive = summaryModel.create({
    deptCode: me.deptCode,
    periodStart: startDate || null,
    periodEnd: endDate || null,
    contentType,
    groupKey,
    version,
    versionType,
    content,
    status: 'draft',
    isPreferred: 0,
    isEnabled: 0,
    snapshot,
    referencedSamples: referencedSamples.map((s) => ({ id: s.id, version: s.version })),
    modelInfo,
    validation,
    createdBy: me.id,
    createdByName: me.name
  });

  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType: 'generate_summary', targetType: 'summary_archive', targetId: archive.id,
    detail: { groupKey, version, versionType, usedFallback, mismatchCount: mismatches.length }
  });

  return ok(res, {
    archive,
    snapshot,
    referencedSamples: referencedSamples.map((s) => ({
      id: s.id, version: s.version, periodStart: s.periodStart, periodEnd: s.periodEnd,
      isPreferred: s.isPreferred
    })),
    validation,
    usedFallback
  }, usedFallback ? '模型调用失败，已生成模板稿' : '生成成功');
}

// POST /api/summaries/:id/save {content} —— 修改稿（新版本，再校验）
export async function save(req, res) {
  const me = req.currentUser;
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return fail(res, 4040, '存档不存在');
  if (archive.createdBy !== me.id) return fail(res, 4030, '仅本人生成人可修改');
  const content = String((req.body || {}).content || '').trim();
  if (!content) return fail(res, 4000, '正文不能为空');

  const allowed = collectAllowedNumbers(archive.snapshot || {});
  const mismatches = validateNumbers(content, allowed);
  const validation = { ok: mismatches.length === 0, mismatches };

  const next = summaryModel.create({
    deptCode: archive.deptCode,
    periodStart: archive.periodStart,
    periodEnd: archive.periodEnd,
    contentType: archive.contentType,
    groupKey: archive.groupKey,
    version: summaryModel.nextVersion(archive.groupKey),
    versionType: '修改稿',
    content,
    status: 'draft',
    snapshot: archive.snapshot,
    referencedSamples: archive.referencedSamples,
    modelInfo: archive.modelInfo,
    validation,
    createdBy: me.id,
    createdByName: me.name
  });

  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType: 'save_summary', targetType: 'summary_archive', targetId: next.id,
    detail: { basedOn: archive.id, version: next.version, mismatchCount: mismatches.length }
  });
  return ok(res, { archive: next, validation }, '已保存为新版本');
}

// POST /api/summaries/:id/finalize —— 有 mismatch 拒绝（E35）
export async function finalize(req, res) {
  const me = req.currentUser;
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return fail(res, 4040, '存档不存在');
  if (archive.createdBy !== me.id) return fail(res, 4030, '仅本人生成人可定稿');
  if (archive.status === 'final') return fail(res, 4000, '该版本已是定稿');
  const v = archive.validation || { mismatches: [] };
  if (v.mismatches && v.mismatches.length) {
    return fail(res, 4000, `存在未处理的数字偏差：${v.mismatches.join('、')}，与快照不一致，不能定稿`);
  }
  const updated = summaryModel.update(archive.id, { status: 'final', isEnabled: 1 });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType: 'finalize_summary', targetType: 'summary_archive', targetId: archive.id,
    detail: { version: archive.version }
  });
  return ok(res, { archive: updated });
}

// POST /api/summaries/:id/reject —— 标记不采用（仍可查看导出）
export async function reject(req, res) {
  const me = req.currentUser;
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return fail(res, 4040, '存档不存在');
  if (archive.createdBy !== me.id) return fail(res, 4030, '仅本人生成人可操作');
  if (archive.status === 'rejected') return fail(res, 4000, '该版本已标记不采用');
  const updated = summaryModel.update(archive.id, { status: 'rejected' });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType: 'reject_summary', targetType: 'summary_archive', targetId: archive.id,
    detail: { version: archive.version }
  });
  return ok(res, { archive: updated });
}

// POST /api/summaries/:id/prefer —— 标记优选样例（仅科长 role=3）
export async function prefer(req, res) {
  const me = req.currentUser;
  if (me.role !== 3) return fail(res, 4030, '仅科长可标记优选样例');
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return fail(res, 4040, '存档不存在');
  if (archive.status !== 'final') return fail(res, 4000, '仅定稿版本可标记优选样例');
  const updated = summaryModel.update(archive.id, { isPreferred: 1 });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType: 'prefer_sample', targetType: 'summary_archive', targetId: archive.id,
    detail: { version: archive.version }
  });
  return ok(res, { archive: updated });
}

// POST /api/summaries/:id/toggle-sample —— 启用/停用样例（仅科长）
export async function toggleSample(req, res) {
  const me = req.currentUser;
  if (me.role !== 3) return fail(res, 4030, '仅科长可启用/停用样例');
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return fail(res, 4040, '存档不存在');
  if (archive.status !== 'final') return fail(res, 4000, '仅定稿样例可启用/停用');
  const next = archive.isEnabled === 1 ? 0 : 1;
  const updated = summaryModel.update(archive.id, { isEnabled: next });
  logModel.addOperationLog({
    operatorId: me.id, operatorName: me.name,
    actionType: 'toggle_sample', targetType: 'summary_archive', targetId: archive.id,
    detail: { version: archive.version, isEnabled: next }
  });
  return ok(res, { archive: updated });
}

// GET /api/summaries?groupKey=&status=&page=
export async function list(req, res) {
  const me = req.currentUser;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20));
  const result = summaryModel.list({
    creatorIds: visibleCreatorIds(me),
    groupKey: String(req.query.groupKey || ''),
    status: String(req.query.status || ''),
    page, pageSize
  });
  return ok(res, result);
}

// GET /api/summaries/:id
export async function detail(req, res) {
  const me = req.currentUser;
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return fail(res, 4040, '存档不存在');
  if (!canViewArchive(me, archive)) return fail(res, 4030, '无权限查看该存档');
  return ok(res, {
    ...archive,
    snapshot: archive.snapshot,
    referencedSamples: archive.referencedSamples,
    validation: archive.validation,
    modelInfo: archive.modelInfo
  });
}

// GET /api/experience/samples?type= —— level≥2 或记账员；科员 4030
export async function experienceSamples(req, res) {
  const me = req.currentUser;
  if (me.role < 2 && me.isBookkeeper !== 1) {
    return fail(res, 4030, '科员无经验库访问权限');
  }
  const type = String(req.query.type || '');
  const list = summaryModel.listSamples({ deptCode: me.deptCode, contentType: type });
  return ok(res, {
    list: list.map((a) => ({
      id: a.id, version: a.version, versionType: a.versionType,
      periodStart: a.periodStart, periodEnd: a.periodEnd, contentType: a.contentType,
      wordCount: a.wordCount, status: a.status,
      isPreferred: a.isPreferred, isEnabled: a.isEnabled,
      createdByName: a.createdByName, createdAt: a.createdAt
    }))
  });
}

// ============ Word / PPT 导出 ============

async function loadArchiveForExport(req, res) {
  const archive = summaryModel.findById(Number(req.params.id));
  if (!archive) return { err: fail(res, 4040, '存档不存在') };
  if (!canViewArchive(req.currentUser, archive)) return { err: fail(res, 4030, '无权限导出该存档') };
  return { archive };
}

// GET /api/summaries/:id/export-word
export async function exportWord(req, res) {
  const { archive, err } = await loadArchiveForExport(req, res);
  if (err) return err;
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');
  const company = settingModel.get('company_name') || 'XX单位';
  const title = `${company}工作总结（${archive.periodStart || ''}至${archive.periodEnd || ''}）`;

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, font: '宋体', size: 36 })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `版本：${archive.version}（${archive.versionType}）`, font: '宋体', size: 24 })]
    })
  ];
  for (const para of String(archive.content).split('\n')) {
    children.push(new Paragraph({
      spacing: { line: 360, after: 120 },
      children: [new TextRun({ text: para, font: '宋体', size: 24 })]
    }));
  }
  children.push(new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ text: `生成时间：${archive.createdAt}`, font: '宋体', size: 21 })]
  }));

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const fname = encodeURIComponent(`工作总结-${archive.version}.docx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="summary.docx"; filename*=UTF-8''${fname}`);
  return res.send(Buffer.from(buffer));
}

// GET /api/summaries/:id/export-pptx
export async function exportPptx(req, res) {
  const { archive, err } = await loadArchiveForExport(req, res);
  if (err) return err;
  const pptxgen = (await import('pptxgenjs')).default;
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = archive.createdByName || '';

  const company = settingModel.get('company_name') || 'XX单位';
  const s = archive.snapshot?.stats || {};
  const sections = splitSections(archive.content);

  // 1 封面
  const s1 = pptx.addSlide();
  s1.background = { color: 'F2F5F9' };
  s1.addText(company, { x: 0.5, y: 1.8, w: '90%', align: 'center', fontSize: 20, color: '555555' });
  s1.addText('工作总结', { x: 0.5, y: 2.6, w: '90%', align: 'center', fontSize: 40, bold: true, color: '1F3864' });
  s1.addText(`${archive.periodStart || ''} 至 ${archive.periodEnd || ''}　${archive.version}（${archive.versionType}）`, {
    x: 0.5, y: 4.0, w: '90%', align: 'center', fontSize: 16, color: '666666'
  });

  // 2 本期工作概览（快照数字表）
  const s2 = pptx.addSlide();
  s2.addText('本期工作概览', { x: 0.4, y: 0.2, fontSize: 24, bold: true, color: '1F3864' });
  const ratePct = Math.round((s.completionRate || 0) * 100);
  s2.addTable([
    [{ text: '应完成', options: { bold: true } }, { text: `${s.totalWork ?? 0} 项` },
     { text: '已完成', options: { bold: true } }, { text: `${s.completed ?? 0} 项` }],
    [{ text: '进行中', options: { bold: true } }, { text: `${s.inProgress ?? 0} 项` },
     { text: '未开始', options: { bold: true } }, { text: `${s.notStarted ?? 0} 项` }],
    [{ text: '完成率', options: { bold: true } }, { text: `${ratePct}%` },
     { text: '逾期', options: { bold: true } }, { text: `${s.overdue ?? 0} 项` }]
  ], { x: 0.6, y: 1.0, w: '88%', border: { pt: 1, color: 'BBBBBB' }, fontSize: 16 });

  // 3 重点工作完成情况（正文）
  const s3 = pptx.addSlide();
  s3.addText('重点工作完成情况', { x: 0.4, y: 0.2, fontSize: 24, bold: true, color: '1F3864' });
  s3.addText(sections.main || String(archive.content), { x: 0.6, y: 1.0, w: '88%', h: '75%', fontSize: 14, valign: 'top' });

  // 4 物料与资金（占位待 S8）
  const s4 = pptx.addSlide();
  s4.addText('物料与资金情况', { x: 0.4, y: 0.2, fontSize: 24, bold: true, color: '1F3864' });
  s4.addText('（待S8：物料收发存与资金执行数据接入后填充）', { x: 0.6, y: 2.5, w: '88%', fontSize: 18, color: '999999' });

  // 5 图表页：快照类别分布（原生图表）
  const s5 = pptx.addSlide();
  s5.addText('工作类别分布', { x: 0.4, y: 0.2, fontSize: 24, bold: true, color: '1F3864' });
  const dist = Array.isArray(s.categoryDistribution) ? s.categoryDistribution : [];
  if (dist.length) {
    s5.addChart(pptx.ChartType.doughnut, [{
      name: '类别分布',
      labels: dist.map((c) => c.category),
      values: dist.map((c) => c.count)
    }], { x: 0.8, y: 1.0, w: '84%', h: '80%', showLegend: true, showPercent: true });
  } else {
    s5.addText('本期无工作数据', { x: 0.6, y: 2.5, w: '88%', fontSize: 16, color: '999999' });
  }

  // 6 存在问题
  const s6 = pptx.addSlide();
  s6.addText('存在问题', { x: 0.4, y: 0.2, fontSize: 24, bold: true, color: 'C00000' });
  s6.addText(sections.issues || '（详见总结正文）', { x: 0.6, y: 1.0, w: '88%', h: '75%', fontSize: 14, valign: 'top' });

  // 7 下期安排
  const s7 = pptx.addSlide();
  s7.addText('下期安排', { x: 0.4, y: 0.2, fontSize: 24, bold: true, color: '2E7D32' });
  s7.addText(sections.next || '（详见总结正文）', { x: 0.6, y: 1.0, w: '88%', h: '75%', fontSize: 14, valign: 'top' });

  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  const fname = encodeURIComponent(`工作总结-${archive.version}.pptx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="summary.pptx"; filename*=UTF-8''${fname}`);
  return res.send(Buffer.from(buffer));
}
