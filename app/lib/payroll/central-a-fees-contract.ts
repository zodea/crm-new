import type { NavigationIntentDTO } from '../../types/read-model'
import type { PayrollAAmount, PayrollABlocker, PayrollACommand, PayrollACommandResult, PayrollAConfigScope, PayrollAContext, PayrollADraft, PayrollAFormRead, PayrollAFrozenDocument, PayrollAOptions, PayrollAPeriodKind, PayrollAPriceScope, PayrollAQuantityFact, PayrollAStatementSourceSnapshot } from './central-a-contract'
import type { PayrollActualRef } from './central-actual-contract'
import type { PayrollHistoryEntry, PayrollQuery } from './central-contract'

/** P5 独立扩展。旧 A/source V1 的缺省字段及原 JSON 不补写、不规范化。 */
export type PayrollFieldFact<T> = { state: 'missing' } | { state: 'null', value: null } | { state: 'value', value: T }

/** B 主档 owner 在工资事务内提供；不能以表单默认值代替原属性事实。 */
export interface PayrollCrewFeeDefaults {
  crewId: string
  sourceVersion: string
  rentEnabled: PayrollFieldFact<boolean>
  rentUnitPrice: PayrollFieldFact<number>
  managementEnabled: PayrollFieldFact<boolean>
  managementUnitPrice: PayrollFieldFact<number>
}

/** 与 advance/final、月度/结算/尾款正交；管理费仍属于 A 格式族。 */
export type PayrollABookRef = { bookPurpose: 'ordinary', managementBookId: null }
  | { bookPurpose: 'management', managementBookId: string }

/** 只能由已证来源建立；旧 A 无用途证据时保留原身份，不能猜成管理簿。 */
export type PayrollABookProof = { state: 'proven', book: PayrollABookRef, sourceVersion: string }
  | { state: 'unproven', book: null, reasons: string[] }

export interface PayrollAFeeCell { unitId: string, roomId: string, itemId: string }

/**
 * 原执行责任与费用收款人分别保存。assignments/cells 均须非空且无重复。
 * scopeIds 是该 assignment 已证的物理 scope 行；whole-trade 的空 scopeIds 不代表空 cells。
 * 未完成的负价依据可引用明确责任格子，无需伪造 completion。
 */
export interface PayrollAManagementScope {
  assignments: Array<{ assignmentId: string, scopeIds: string[], cells: PayrollAFeeCell[] }>
}

/** 唯一已定基数；itemIds 必须显式非空，cells 空集合不能表示全项目。 */
export interface PayrollAFeeBasis {
  kind: 'completed-field-quantity'
  itemIds: string[]
  scope: PayrollAPriceScope
}

/** 稳定簿身份不因人员改名/转组改变；换管理人建立新簿，旧已领不自动转移。 */
export interface PayrollAManagementBook {
  id: string
  projectId: string
  /** 公司代管可未指定管理人；此时没有管理单资格，不能回填负责人。 */
  managerWorkerId: string | null
  createdBy: string
  createdAt: string
  deletedAt: string | null
}

export interface PayrollAManagementBookRevision {
  id: string
  managementBookId: string
  projectId: string
  revision: number
  effectiveMonth: string
  managementMode: 'crew-managed' | 'company-managed'
  scope: PayrollAManagementScope
  initialPayRatio: number | null
  evidenceNote: string
  sourceVersion: string
  operatorId: string
  createdAt: string
}

export interface PayrollAManagementBookDraft {
  managementBookId: string | null
  baseRevisionId: string | null
  managerWorkerId: string | null
  effectiveMonth: string
  managementMode: 'crew-managed' | 'company-managed'
  scope: PayrollAManagementScope
  initialPayRatio: number | null
  evidenceNote: string
}

/** 采用时冻结的建议来源；采用后项目修订不再实时绑定班组默认。 */
export type PayrollAFeeDefaultAdoption = { kind: 'crew-rent' | 'crew-management', fact: PayrollCrewFeeDefaults }
  | { kind: 'confirmed-housing-items', itemIds: string[], unitPrice: 1.3, unit: '㎡', evidenceNote: string }

export type PayrollAFeeOwner = { bookPurpose: 'ordinary', managementBookId: null, kind: 'housing' | 'subsidy' }
  | { bookPurpose: 'management', managementBookId: string, kind: 'management' }

export interface PayrollAFeeValues {
  name: string
  enabled: boolean
  /** 非负；null 是未配置，明确 0 不回填默认价。 */
  unitPrice: number | null
  unit: string | null
  basis: PayrollAFeeBasis
  effectiveMonth: string
  adoptedDefault: PayrollAFeeDefaultAdoption | null
}

/** feeId 是跨修订身份，id 是不可变修订身份；不按名称去重两个合法补贴。 */
export type PayrollAFeeRevision = PayrollAFeeOwner & PayrollAFeeValues & {
  id: string
  feeId: string
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  revision: number
  /** 移除是独立修订，保留原正文；与明确关闭 enabled=false 区分。 */
  removed: boolean
  operatorId: string
  createdAt: string
}

export type PayrollAFeeDraft = PayrollAFeeOwner & PayrollAFeeValues & {
  feeId: string | null
  baseRevisionId: string | null
}

/** 负价只能进入管理清单；不接受自由负总额，不代表第三方现金事实。 */
export interface PayrollANegativeLineValues {
  label: string
  quantity: number | null
  unit: string | null
  /** 完整核对时必须严格小于 0；普通工资和正向费用校验不放宽。 */
  unitPrice: number | null
  scope: PayrollAManagementScope
  reason: string
  evidenceNote: string
  actualRef: PayrollActualRef | null
}

export interface PayrollANegativeLineDraft extends PayrollANegativeLineValues {
  lineId: string | null
  baseRevisionId: string | null
}

/** 每次修改/移除追加修订；发放后禁止写入，交由 P4 更正。 */
export interface PayrollANegativeLineRevision extends PayrollANegativeLineValues {
  id: string
  lineId: string
  statementId: string
  projectId: string
  managementBookId: string
  managementRevisionId: string
  revision: number
  signedAmountFen: number | null
  removed: boolean
  operatorId: string
  createdAt: string
}

export interface PayrollAFeeBlocker extends PayrollABlocker {
  feeId: string | null
  managementBookId: string | null
  negativeLineId: string | null
}

/** 独立于 feeId/bookId/manager/月/completionId；换簿不能重领同一管理用途原责任。 */
export interface PayrollAManagementOwnershipIdentity {
  purpose: 'management-fee'
  projectId: string
  ownershipKey: string
}

/** 首次有效发放建立永久簿归属；同簿后月累计可引用，退款/软删不释放归属。 */
export interface PayrollAManagementOwnershipProof {
  schemaVersion: 1
  identity: PayrollAManagementOwnershipIdentity
  managementBookId: string
  managementRevisionId: string
  firstStatementId: string
  firstCommandId: string
  fact: PayrollAQuantityFact
}

export interface PayrollAManagementOwnership {
  id: string
  projectId: string
  ownershipKey: string
  managementBookId: string
  firstStatementId: string
  proof: PayrollAManagementOwnershipProof
}

/** 原量逐份保留原工人、班组、completion、assignment 与 scope，禁止换成管理人。 */
export interface PayrollAFeeQuantityComponent {
  /** feeId + 原 ownershipKey；展示拆合/月份/completion 重建不得改变领取身份。 */
  componentKey: string
  feeId: string
  feeRevisionId: string
  ownershipKey: string
  /** 普通补贴为 null；管理费必须填同一原责任的固定管理用途身份。 */
  managementOwnership: PayrollAManagementOwnershipIdentity | null
  fact: PayrollAQuantityFact
  quantity: number | null
  unitPrice: number | null
  amountFen: number | null
}

/** 管理费按 buildingId × itemId × unit 分行；不同费项仍保留自己的行。 */
export interface PayrollAFeeLine {
  id: string
  kind: 'housing' | 'subsidy' | 'management'
  feeId: string
  feeRevisionIds: string[]
  name: string
  buildingId: string | null
  buildingName: string | null
  itemId: string
  itemName: string | null
  unit: string | null
  quantity: number | null
  knownQuantity: number | null
  amount: PayrollAAmount
  components: PayrollAFeeQuantityComponent[]
  sources: NavigationIntentDTO[]
  blockers: PayrollAFeeBlocker[]
}

/** 正负费用先组成 listAmount，再沿 A 比例/累计/此前实付计算；负价不二次扣除。 */
export interface PayrollAFeesTotals {
  workAmount: PayrollAAmount
  subsidyAmount: PayrollAAmount
  managementAmount: PayrollAAmount
  negativeAmount: PayrollAAmount
  listAmount: PayrollAAmount
  cumulativeAmount: PayrollAAmount
  previouslyPaid: PayrollAAmount
  grossAmount: PayrollAAmount
}

export interface PayrollAManagementBookRead {
  book: PayrollAManagementBook
  revision: PayrollAManagementBookRevision | null
  managerName: string | null
  eligible: boolean
  reasons: string[]
}

export interface PayrollAFeeConfigScope extends PayrollAConfigScope { book: PayrollABookRef }

export interface PayrollAFeeConfigRead {
  context: PayrollAContext
  scope: PayrollAFeeConfigScope
  /** 所有配置动作都带回 baseVersion，不能仅凭客户端金额相同复用。 */
  baseVersion: string
  options: PayrollAOptions
  crewDefaults: PayrollCrewFeeDefaults | null
  fees: PayrollAFeeRevision[]
  managementBooks: PayrollAManagementBookRead[]
  cellOptions: Array<PayrollAFeeCell & { locationLabel: string }>
  items: Array<{
    itemId: string
    itemName: string | null
    unit: string | null
    /** 缺少可证语义时由经办确认，不按中文名称猜墙/地砖。 */
    housingClassification: PayrollFieldFact<'wall-tile' | 'floor-tile' | 'other'>
    sourceVersion: string
    scopes: PayrollAPriceScope[]
  }>
  responsibilityOptions: Array<{
    assignmentId: string
    workerId: string | null
    crewId: string | null
    scopeIds: string[]
    cells: PayrollAFeeCell[]
    label: string
    eligible: boolean
    reasons: string[]
    sources: NavigationIntentDTO[]
  }>
  blockers: PayrollAFeeBlocker[]
  readonlyReasons: string[]
  /** 已发月只限制原簿配置；新增独立管理簿仍由自己的资格决定。 */
  eligibility: { canSaveFees: boolean, canSaveManagementBook: boolean, canStartManagementDraft: boolean, feeReasons: string[], managementReasons: string[] }
  history: PayrollHistoryEntry[]
}

/** B owner 同事务读取当前可用的原责任格子，包含尚未完成的施工。 */
export interface PayrollAManagementScopeFacts {
  sourceVersion: string
  responsibilityOptions: PayrollAFeeConfigRead['responsibilityOptions']
  cellOptions: PayrollAFeeConfigRead['cellOptions']
  reasons: string[]
}

/** 与现有 A 命令共用授权、队列、receipt 和 pending 协议，不另建工资格式族。 */
export type PayrollAFeesAction = { kind: 'save-a-fees', baseVersion: string, fees: PayrollAFeeDraft[], remove: Array<{ feeId: string, baseRevisionId: string }> }
  | { kind: 'save-a-management-book', baseVersion: string, management: PayrollAManagementBookDraft }
  | { kind: 'start-a-management-draft', baseVersion: string, managementBookId: string, managementRevisionId: string, month: string, periodKind: PayrollAPeriodKind }
  | { kind: 'save-a-negative-lines', baseVersion: string, lines: PayrollANegativeLineDraft[], remove: Array<{ lineId: string, baseRevisionId: string }> }

export interface PayrollAFeesCommand extends Omit<PayrollACommand, 'action' | 'configScope'> {
  book: PayrollABookRef
  configScope: PayrollAFeeConfigScope | null
  action: PayrollAFeesAction
}

export interface PayrollAFeesCommandResult extends PayrollACommandResult {
  book: PayrollABookRef
  managementBookId: string | null
  managementRevisionId: string | null
  feeRevisionIds: string[]
  negativeLineRevisionIds: string[]
  /** 重复发起定位已存合法草稿，不另插一张，不允许读列表自动创建。 */
  locatedExistingDraft: boolean
}

export interface PayrollAFeesPending { command: PayrollAFeesCommand, state: 'sending' | 'unknown' | 'awaiting-read' }
export interface PayrollADraftV2 extends PayrollADraft { book: PayrollABookRef }

/** 每张原单及其已证实际补退归入同簿；未处理的更正差额不是此前实付。 */
export interface PayrollABookPayment {
  statementId: string
  month: string
  book: PayrollABookRef
  actualRefs: PayrollActualRef[]
  amount: PayrollAAmount
  sourceVersion: string
}

export interface PayrollABookEligibility {
  canSave: boolean
  canCheck: boolean
  canRelease: boolean
  reasons: string[]
}

/** 接入原 A 表单时复用 options/eligibility/status；费用不可读时不能退回无费用核算。 */
export interface PayrollAFeesFormRead extends Omit<PayrollAFormRead, 'draft' | 'totals' | 'blockers'> {
  draft: Partial<PayrollADraftV2>
  book: PayrollABookRef | null
  bookProof: PayrollABookProof
  bookEligibility: PayrollABookEligibility
  managementBooks: PayrollAManagementBookRead[]
  /** 稳定 lineId/baseRevisionId 的可编辑稿；已发读取没有可编辑负价稿。 */
  negativeLineDrafts: PayrollANegativeLineDraft[]
  /** 当前单的全部负价修订，含移除修订；用于按回执 ID 核对成功结果和审计。 */
  negativeLineRevisions: PayrollANegativeLineRevision[]
  previousBookPayments: PayrollABookPayment[]
  /** lines/negativeLines/managementOwnership 位于 fees 内，不创建第二份量或费用来源。 */
  fees: PayrollAFeesSourceSnapshot | null
  totals: PayrollAFeesTotals
  blockers: PayrollAFeeBlocker[]
}

/** source_json V2 中 fees 的完整封闭正文，配置改动不回写任何已冻结实例。 */
export interface PayrollAFeesSourceSnapshot {
  schemaVersion: 1
  configSourceVersion: string
  crewDefaults: PayrollCrewFeeDefaults | null
  feeRevisions: PayrollAFeeRevision[]
  management: { book: PayrollAManagementBook, revision: PayrollAManagementBookRevision } | null
  /** 核对时已存归属；新归属仅在发放事务创建，历史原文不在读取时回填。 */
  managementOwnership: PayrollAManagementOwnership[]
  negativeLines: PayrollANegativeLineRevision[]
  lines: PayrollAFeeLine[]
  totals: PayrollAFeesTotals
}

/**
 * 新单 source_json 才采用 V2；旧 V1 不加 book/fees，更不改原字符串或指纹。
 * management 必须与 book 匹配；ordinary 禁止管理费/负价，management 禁止住房补贴/普通工作工资行。
 * subject/facts 永远保存原执行事实；输出收款身份由 book 及管理关系证明。
 */
export interface PayrollAStatementSourceSnapshotV2 extends Omit<PayrollAStatementSourceSnapshot, 'schemaVersion'> {
  schemaVersion: 2
  book: PayrollABookRef
  fees: PayrollAFeesSourceSnapshot
}
export type PayrollAStatementSourceVersioned = PayrollAStatementSourceSnapshot | PayrollAStatementSourceSnapshotV2

/** 明确受控投影，旧 frozen document 不反向注入缺省 book/fees。 */
export interface PayrollAFeesFrozenDocument extends PayrollAFrozenDocument {
  book: PayrollABookRef
  fees: PayrollAFeesSourceSnapshot
  listAmount: number
  /** 每条历史实付必须已证明同一簿，不按管理人姓名或成员交集归并。 */
  previousBookPayments: Array<{ statementId: string, month: string, amount: number, book: PayrollABookRef }>
}

export type PayrollAFeesOutputRead = { context: PayrollAContext, statementId: string } & (
  { state: 'available', document: PayrollAFeesFrozenDocument, reasons: [] }
  | { state: 'unavailable', document: null, reasons: string[] }
)

/** P4 新来源的费用依据扩展；旧 basis/confirmed_snapshot_json 原样留存。 */
export interface PayrollAFeeAdjustmentBasis {
  schemaVersion: 1
  book: PayrollABookRef
  components: Array<{ componentKey: string, feeId: string, feeRevisionId: string, ownershipKey: string, quantity: number | null, unitPrice: number | null }>
  negativeLines: Array<PayrollANegativeLineValues & { lineId: string, originalNegativeRevisionId: string }>
}

export interface PayrollAFeesRepository {
  aFeeConfig: (query: PayrollQuery, scope: PayrollAFeeConfigScope) => Promise<PayrollAFeeConfigRead>
  executeFees: (command: PayrollAFeesCommand) => Promise<PayrollAFeesCommandResult>
}

/** 仅对已经过 read codec 验证的领域 DTO 缩窄，不代替未知输入验证。 */
export function hasPayrollAFeesForm(read: PayrollAFormRead): read is PayrollAFeesFormRead {
  return Object.hasOwn(read, 'fees') && Object.hasOwn(read, 'bookProof')
}

export function hasPayrollAFeesDocument(document: PayrollAFrozenDocument): document is PayrollAFeesFrozenDocument {
  return Object.hasOwn(document, 'book') && Object.hasOwn(document, 'fees')
}
