export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

export type UserStatus = 'active' | 'disabled'

export interface AuthUser {
  id: number
  userNo: string
  name: string
  /** 角色层级：1 科员 / 2 副科长 / 3 科长 / 4 副总师 / 5 公司副经理 */
  role: number
  deptCode: string
  deptName: string
  parentId: number | null
  status: UserStatus
  isBookkeeper: 0 | 1
  mustChangePassword: boolean
}

export interface LoginParams {
  userNo: string
  password: string
}

export interface LoginResult {
  token: string
  user: AuthUser
  mustChangePassword: boolean
}

export interface ChangePasswordParams {
  oldPassword: string
  newPassword: string
}

export interface DelegationInfo {
  authorizerId: number
  authorizerName: string
  startTime: string
  endTime: string
}

export interface AccountingPerm {
  view: boolean
  operate: boolean
  isDelegate: boolean
  delegationInfo: DelegationInfo | null
}

export interface AssignableTarget {
  id: number
  userNo: string
  name: string
  role: number
}

export interface Permissions {
  menus: string[]
  buttons: string[]
  accounting: AccountingPerm
  assignableRoles: number[]
  assignableTargets: AssignableTarget[]
}

export interface MeResult {
  user: AuthUser
  permissions: Permissions
}

export interface UserListItem {
  id: number
  userNo: string
  name: string
  role: number
  deptCode: string
  deptName: string
  parentId: number | null
  status: UserStatus
  isBookkeeper: 0 | 1
}

export interface UserListResult {
  list: UserListItem[]
  total: number
}

export interface CreateUserParams {
  userNo: string
  name: string
  role: number
  deptCode: string
  initialPassword?: string
}

export interface Bookkeeper {
  userId: number
  userNo: string
  name: string
}

export interface Delegation {
  id: number
  bookkeeperId: number
  delegateId: number
  delegateName: string
  startTime: string
  endTime: string
  status: 'active' | 'revoked' | 'expired'
  revokedAt: string | null
  createdAt: string
}

export interface CreateDelegationParams {
  delegateId: number
  startTime: string
  endTime: string
}

export interface OperationLog {
  id: number
  operatorId: number
  operatorName: string
  actionType: string
  targetType: string
  targetId: string | number | null
  detail: string
  createdAt: string
}

export interface OperationLogResult {
  list: OperationLog[]
  total: number
}

export interface LoginLog {
  id: number
  userNo: string
  userName: string
  ip: string
  userAgent: string
  status: 'success' | 'fail'
  failReason: string | null
  abnormal: 0 | 1
  createdAt: string
}

export interface LoginLogResult {
  list: LoginLog[]
  total: number
}

// ==================== S3+S4：字典 / 工作 / 进度 / 附件 / 标注 / 工作台 ====================

/** 字典类型（契约 §1） */
export type DictType = 'work_category' | 'priority' | 'item_category' | 'status_tag'

export interface DictItem {
  id: number
  dictType: DictType | string
  label: string
  code: string | null
  sortOrder: number
  status: 'active' | 'disabled'
  createdAt?: string
}

export interface CreateDictParams {
  type: DictType | string
  label: string
  code?: string
  sortOrder?: number
}

export interface UpdateDictParams {
  label?: string
  sortOrder?: number
}

/** 工作状态机（契约 §2.2） */
export type WorkStatus = '未开始' | '进行中' | '已完成' | '已取消' | '已改派'

export interface WorkListItem {
  id: number
  name: string
  category: string
  content?: string
  startTime: string
  dueTime: string
  priority: string
  status: WorkStatus
  assigneeId: number
  assigneeName: string
  sourceId: number | null
  sourceName?: string | null
  collaboratorIds: number[]
  collaboratorNames?: string[]
  lastProgressAt: string | null
  isStalled?: boolean
  stalledDays?: number
}

export interface WorkListResult {
  list: WorkListItem[]
  total: number
}

export interface CreateWorkParams {
  name: string
  category: string
  content: string
  startTime: string
  dueTime: string
  priority: string
  collaboratorIds?: number[]
  /** 指派对象：为空=本人登记；非空=指派（后端强制 category=上级安排工作、写 source_id） */
  assigneeId?: number
}

export interface ProgressRecord {
  id: number
  workId: number
  authorId: number
  authorName: string
  authorType: 'owner' | 'collaborator'
  content: string
  createdAt: string
}

export interface AttachmentItem {
  id: number
  workId: number
  progressId: number | null
  uploaderId: number
  uploaderName?: string
  originalName: string
  storedName?: string
  mimeType: string
  size: number
  createdAt: string
}

export interface AnnotationItem {
  id: number
  workId: number
  authorId: number
  authorName: string
  content: string
  replyContent: string | null
  replyAt: string | null
  createdAt: string
}

export interface WorkDetail extends WorkListItem {
  summary: string | null
  cancelReason: string | null
  isUnlocked: 0 | 1
  progress: ProgressRecord[]
  attachments: AttachmentItem[]
  annotations: AnnotationItem[]
}

/** 待办全类型（S11 契约 §1.1 八类） */
export type DashboardTodoType =
  | 'assignedNew'
  | 'dueToday'
  | 'overdue'
  | 'annotationsUnreplied'
  | 'pendingApprovals'
  | 'delegationExpiring'
  | 'stalled'
  | 'backupFailure'

/** 待办各类型计数（S11：todo 扩展 pendingApprovals/delegationExpiring/backupFailure） */
export interface TodoCounters {
  assignedNew: number
  dueToday: number
  overdue: number
  annotationsUnreplied: number
  pendingApprovals: number
  delegationExpiring: number
  stalled: number
  backupFailure: number
}

/** 未读提醒类型（S11 契约 §1.1 notice_reads：标注/被指派/账目确认） */
export type NoticeType = 'annotation' | 'assigned' | 'approval'

/** 各类型未读计数（summary 返回，字段后端 S11 补齐前可能缺省） */
export interface NoticeUnread {
  annotation: number
  assigned: number
  approval: number
}

/** 工作台概览（S4 基础 + S11 扩展） */
export interface DashboardSummary {
  todo: TodoCounters
  counts: {
    inProgress: number
    dueThisWeek: number
    overdue: number
    completedThisMonth: number
  }
  annotationsUnreplied: number
  /** 未读计数（契约 §1.1） */
  unread?: NoticeUnread
}

export interface DashboardTodoItem {
  /** 工作类待办携带；非工作类（待确认账目/代录临期/备份失败）可能为 null */
  workId: number | null
  /** notice_reads.ref_id，用于点击后标记已读 */
  refId?: number | null
  name: string
  assigneeName: string
  type: DashboardTodoType
  time?: string | null
  /** 兼容后端 S4 旧字段（dueTime） */
  dueTime?: string | null
  category?: string
  status?: string
  isStalled?: boolean
  stalledDays?: number
  /** 停滞工作最后进度时间与内容（契约 §1.1 progressText） */
  lastProgressAt?: string | null
  progressText?: string | null
  /** 是否未读（标注/被指派/账目确认三类） */
  unread?: boolean
}

/** 下级动态明细行（S11 契约 §1.3，近7天） */
export interface SubordinateActivityItem {
  workId: number
  workName: string
  /** 新进度=进度内容；新指派=被指派人姓名；逾期=负责人姓名 */
  detailName: string
  /** 新进度=填写人；新指派=指派方；逾期可空 */
  operatorName?: string
  createdAt: string
}

export interface SubordinateActivity {
  newProgress: SubordinateActivityItem[]
  assigned: SubordinateActivityItem[]
  overdue: SubordinateActivityItem[]
}

// ==================== S12：备份与恢复 ====================

export type BackupType = 'manual' | 'auto'
export type BackupStatus = 'success' | 'failed'

/** backup_logs 一行（契约 §2.1） */
export interface BackupRecord {
  id: number
  fileName: string
  fileSize: number
  sha256: string
  type: BackupType
  status: BackupStatus
  reason: string | null
  createdAt: string
  backupTime: string
  recordCounts?: Record<string, number> | null
  attachmentCount?: number
  totalSize?: number
  schemaVersion?: number
}

/** POST /api/admin/backup 返回（契约 §2.2） */
export interface BackupCreateResult {
  id: number
  name: string
  size: number
  sha256: string
}

/** GET /api/admin/storage 返回 */
export interface StorageInfo {
  /** 备份目录占用（字节） */
  backupDirSize: number
  /** 磁盘剩余（字节） */
  diskFree: number
  /** 当前备份数量 */
  retainedCount: number
  /** 保留上限（自动备份最近7份） */
  retainLimit: number
  /** 低于低阈值提醒 */
  lowThreshold: boolean
  message?: string | null
}

/** POST /api/admin/restore/preview 返回 */
export interface RestorePreview {
  previewToken: string
  backupTime: string
  recordCounts: Record<string, number>
  attachmentCount: number
  totalSize: number
  schemaVersion: number
  systemVersion?: string
}

/** POST /api/admin/restore/confirm 返回 */
export interface RestoreConfirmResult {
  restoredAt: string
  restoredCounts: Record<string, number>
  missingItems: string[]
  anomalies: string[]
}

/** GET /api/admin/restore/status：维护锁状态（恢复期间其他写请求 5030） */
export interface RestoreStatus {
  maintenance: boolean
  stage?: string | null
}

// ==================== S5：汇总统计 ====================

/** 人员口径（契约 §1）：mine=本人 / subordinates=看到底范围 / dept=全科室 */
export type PersonScope = 'mine' | 'subordinates' | 'dept'

export interface CategoryCount {
  category: string
  count: number
}

export interface PerPersonStat {
  userId: number
  userNo: string
  name: string
  total: number
  completed: number
  /** 完成率 0-1（应完成为 0 时为 0） */
  rate: number
}

/** GET /api/stats/work-summary 返回（统计口径以后端为唯一权威） */
export interface WorkSummaryStats {
  completionRate: number
  totalWork: number
  completed: number
  inProgress: number
  notStarted: number
  cancelled: number
  overdue: number
  categoryDistribution: CategoryCount[]
  perPerson: PerPersonStat[]
  /** 统计口径说明（页面展示） */
  scopeDesc: string
  /** 数据截止时间 */
  generatedAt: string
}

/** GET /api/stats/work-detail 明细行（与 summary 同源聚合） */
export interface StatsWorkDetailItem {
  id: number
  name: string
  category: string
  status: WorkStatus
  priority: string
  assigneeId: number
  assigneeName: string
  startTime: string
  dueTime: string | null
  isStalled?: boolean
  stalledDays?: number
}

export interface StatsWorkDetailResult {
  list: StatsWorkDetailItem[]
  total: number
}

// ==================== S6/S7：总结存档 / 经验库 ====================

/** 内容类型：work=工作 / accounting=记账 / both=两者 */
export type SummaryContentType = 'work' | 'accounting' | 'both'

/** 版本类型：初稿 / 修改稿 / 模板稿（契约 §2.1） */
export type SummaryVersionType = '初稿' | '修改稿' | '模板稿'

/** 状态：draft=草稿 / final=已定稿 / rejected=不采用 */
export type SummaryArchiveStatus = 'draft' | 'final' | 'rejected'

/** 数字校验结果（契约 §2.2）：mismatches=正文里出现但快照数值集里没有的数字；后端实际可能返回字符串形式（如 ["99"]） */
export interface ValidationResult {
  ok: boolean
  mismatches: Array<string | number>
  reason?: string
}

/** 生成时固化的统计快照（数字以此为准，模型不计算） */
export interface SummarySnapshot {
  totalWork?: number
  completed?: number
  inProgress?: number
  notStarted?: number
  cancelled?: number
  overdue?: number
  completionRate?: number
  categoryDistribution?: CategoryCount[]
  /** 物料/资金字段 S8 后补齐，本阶段为 null */
  materialFunding?: unknown | null
}

/** 引用样例（生成结果里展示） */
export interface ReferencedSample {
  id?: number
  version?: string
  periodStart?: string
  periodEnd?: string
  contentType?: SummaryContentType | string
  versionType?: SummaryVersionType | string
  isPreferred?: 0 | 1
  content?: string
}

/** 模型调用留痕 */
export interface ModelInfo {
  model?: string
  durationMs?: number
  tokens?: number
  [key: string]: unknown
}

/** summary_archives 一行（契约 §2.1） */
export interface SummaryArchive {
  id: number
  deptCode: string
  periodStart: string
  periodEnd: string
  contentType: SummaryContentType | string
  groupKey: string
  /** v1 / v2 / v3… */
  version: string
  versionType: SummaryVersionType | string
  content: string
  wordCount: number
  status: SummaryArchiveStatus
  isPreferred: 0 | 1
  isEnabled: 0 | 1
  /** JSON 文本或已解析对象，后端返回形态不一，前端用 parseJsonField 归一 */
  snapshot: string | SummarySnapshot
  referencedSamples: string | ReferencedSample[]
  validation: string | ValidationResult
  modelInfo: string | ModelInfo
  createdBy: number
  createdByName?: string
  createdAt: string
}

/** POST /api/summaries/generate 返回 */
export interface GenerateSummaryResult {
  archive: SummaryArchive
  snapshot: SummarySnapshot
  referencedSamples: ReferencedSample[]
  validation: ValidationResult
  usedFallback: boolean
}

export interface SummaryListResult {
  list: SummaryArchive[]
  total: number
}

/** 经验库样例（GET /api/experience/samples） */
export interface ExperienceSample {
  id: number
  contentType: SummaryContentType | string
  periodStart: string
  periodEnd: string
  version: string
  versionType: SummaryVersionType | string
  content: string
  isEnabled: 0 | 1
  isPreferred: 0 | 1
  createdByName?: string
  createdAt: string
}

// ==================== S8：物料账 / S9：资金账与挂账 / S10：月度报表 ====================

/** 物品（契约 §3.1 material_items） */
export interface MaterialItem {
  id: number
  name: string
  unit: string
  /** 库存下限（最低结存数量），默认 0 */
  minStock: number
  createdAt?: string
}

export interface CreateMaterialItemParams {
  name: string
  unit: string
  minStock?: number
}

/** 月度物料计划行（追加=新行，is_append=1） */
export interface MaterialPlan {
  id: number
  month: string
  itemId: number
  itemName?: string
  plannedQty: number
  referencePrice: number
  plannedAmount: number
  isAppend: 0 | 1
  appendNote?: string | null
  appendAt?: string | null
  appendBy?: string | null
  createdBy?: number
  createdAt: string
}

export interface CreateMaterialPlanParams {
  month: string
  itemId: number
  plannedQty: number
  referencePrice: number
  isAppend?: 0 | 1
  appendNote?: string
}

/** 领用登记（每笔自动生成一个批次） */
export interface MaterialReceipt {
  id: number
  receiptNo: string
  month: string
  itemId: number
  itemName?: string
  planId: number | null
  qty: number
  unitPrice: number
  amount: number
  receiptDate: string
  handler: string
  voucher: string | null
  /** 超计划标红（C17：允许登记不阻断） */
  overPlan: 0 | 1
  status: 'normal' | 'void'
  voidReason?: string | null
  createdAt: string
}

export interface CreateReceiptParams {
  month: string
  itemId: number
  planId?: number | null
  qty: number
  unitPrice: number
  receiptDate: string
  handler: string
  voucher?: string
}

/** 发放登记（FIFO 扣减批次） */
export interface MaterialIssue {
  id: number
  issueNo: string
  month: string
  itemId: number
  itemName?: string
  userId: number
  userName?: string
  qty: number
  issueDate: string
  handler: string
  status: 'normal' | 'void'
  voidReason?: string | null
  createdAt: string
}

export interface CreateIssueParams {
  month: string
  itemId: number
  userId: number
  qty: number
  issueDate: string
  handler: string
}

/** GET /api/accounting/stock?month= 结存视图行（按物品独立，契约 §3.2） */
export interface StockRow {
  itemId: number
  itemName: string
  unit: string
  /** 期初结存（上期结存自动带入） */
  openingQty: number
  /** 本期领用 */
  receiptQty: number
  /** 本期发放 */
  issueQty: number
  /** 期末结存数量 */
  closingQty: number
  /** 结存金额=Σ剩余批次 remaining×单价（不取平均价，C28） */
  closingAmount: number
  /** 待发放数量（Σ批次 remaining_qty） */
  pendingIssueQty: number
  minStock: number
  /** 结存低于下限预警（C29） */
  lowStock: boolean
}

/** GET /api/accounting/my-items（C26：仅物品/数量/日期/发放人，无单价金额结存他人记录） */
export interface MyItem {
  id: number
  itemId: number
  itemName: string
  qty: number
  issueDate: string
  /** 发放人 */
  handler: string
  status: string
}

/** 盘点单明细行（契约 §3.1 stocktaking_items） */
export interface StocktakingItemRow {
  id?: number
  itemId: number
  itemName?: string
  /** 发起时账面数（锁定） */
  bookQty: number
  /** 实盘数量（记账员录入） */
  actualQty: number | null
  /** diff=实盘-账面 */
  diff: number | null
  /** 盘盈盘亏必填原因 */
  reason: string | null
}

/** 盘点单 */
export interface Stocktaking {
  id: number
  month: string
  status: 'open' | 'confirmed' | 'void'
  createdAt: string
  createdByName?: string
  confirmedAt?: string | null
  confirmedByName?: string | null
  voidReason?: string | null
  items: StocktakingItemRow[]
}

/** 跨天修改/作废确认（契约 §3.1 accounting_approvals，C23） */
export type ApprovalTargetType = 'receipt' | 'issue' | 'expense'
export type ApprovalAction = 'edit' | 'void'

export interface AccountingApproval {
  id: number
  targetType: ApprovalTargetType
  targetId: number
  action: ApprovalAction
  reason: string
  changes?: Record<string, unknown> | null
  status: 'pending' | 'approved' | 'rejected'
  requestedByName?: string
  requestedAt: string
  confirmNote?: string | null
  confirmedByName?: string | null
  confirmedAt?: string | null
}

export interface CreateModifyRequestParams {
  targetType: ApprovalTargetType
  targetId: number
  action: ApprovalAction
  reason: string
  changes?: Record<string, unknown>
}

/** 资金计划行（每月单独核算，上月额度不带入，C19） */
export interface FundPlan {
  id: number
  month: string
  item: string
  plannedAmount: number
  isAppend: 0 | 1
  appendNote?: string | null
  createdAt: string
}

export interface CreateFundPlanParams {
  month: string
  item: string
  plannedAmount: number
  isAppend?: 0 | 1
  appendNote?: string
}

/** 支出销账状态机（C21）：挂账→部分销账→挂账/已结清 */
export type SettleStatus = '计划内' | '挂账' | '部分销账' | '已结清'

export interface FundExpense {
  id: number
  expenseNo: string
  month: string
  item: string
  amount: number
  payee: string
  expenseDate: string
  handler: string
  voucher: string | null
  planId: number | null
  settleStatus: SettleStatus | string
  status: 'normal' | 'void'
  /** 挂账剩余金额 */
  remainAmount?: number
  voidReason?: string | null
  createdAt: string
}

export interface CreateExpenseParams {
  month: string
  item: string
  amount: number
  payee: string
  expenseDate: string
  handler: string
  voucher?: string
  planId?: number | null
}

export interface SettleExpenseParams {
  planId: number
  settleAmount: number
  /** 销账金额≠挂账剩余时必填（契约 §4） */
  diffReason?: string
}

/** GET /api/accounting/ledger 挂账清单行（C22：超30天提醒） */
export interface LedgerRow {
  id: number
  expenseNo: string
  item: string
  amount: number
  remainAmount: number
  expenseDate: string
  /** 挂账天数=今日-发生日期 */
  days: number
  /** 是否已补计划 */
  hasPlan: boolean
  settleStatus: string
}

/** 月度报表类型（契约 §5 四张表） */
export type ReportType = 'material_plan' | 'fund_execution' | 'ledger' | 'person_work'

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  material_plan: '物料计划执行表',
  fund_execution: '资金执行表',
  ledger: '挂账清单',
  person_work: '人员工作完成表'
}

/** GET /api/reports?month= 月报元信息（含只读锁状态 C24） */
export interface MonthlyReportMeta {
  month: string
  status: 'draft' | 'archived'
  generatedAt?: string
  generatedByName?: string
  summaryText?: string
  summaryUpdatedAt?: string
  summaryUpdatedByName?: string
  /** 报表生成后当月账目只读（C24） */
  locked: boolean
}

/** GET /api/reports/:month/:type 单表数据（数字与明细同源，D33） */
export interface ReportTableData {
  month: string
  reportType: ReportType
  columns: Array<{ prop: string; label: string }>
  rows: Array<Record<string, string | number | null>>
}

/** GET /api/reports/:month/:type/detail 下钻明细行 */
export interface ReportDetailRow {
  id: number
  no: string
  date: string
  item: string
  qty?: number
  amount?: number
  status?: string
  remark?: string
}

// ---------- 统计账目区（§6 联动） ----------

export type AccountingSummaryType = 'material' | 'fund' | 'ledger'

/** GET /api/stats/accounting-summary?month=&type= 返回 */
export interface AccountingSummaryResult {
  type: AccountingSummaryType
  month: string
  /** 物料：领用/发放/结存趋势 */
  materialTrend?: Array<{
    period: string
    itemName: string
    receivedQty: number
    issuedQty: number
    stockQty: number
  }>
  /** 资金：计划执行率 */
  fundExecution?: {
    plannedAmount: number
    spentAmount: number
    balance: number
    rate: number
  }
  /** 挂账：账龄分布 */
  ledgerAging?: Array<{ bucket: string; amount: number; count: number }>
}

/** GET /api/dashboard/accounting 首页账目概览（F43/F45） */
export interface DashboardAccounting {
  month: string
  /** 本月计划金额 */
  plannedAmount: number
  /** 已领用金额 */
  receivedAmount: number
  /** 结存数量 */
  stockQty: number
  /** 结存金额 */
  stockAmount: number
  /** 挂账金额 */
  ledgerAmount: number
  /** 待发放数量 */
  pendingIssueQty: number
  /** 库存下限预警物品（C29） */
  lowStockItems: Array<{ itemName: string; stockQty: number; minStock: number }>
  /** 超30天挂账笔数（C22） */
  overdueLedgerCount: number
}
