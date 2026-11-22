import type { KitTableColumn } from '~/lib/kit/table'
import type { OwnerCommercialDocumentListItemDTO } from '~/lib/owner-document/central-repository'
import type {
  OwnerDocumentKind,
  OwnerDocumentListRecord,
} from '~/lib/owner-document/forms'
import { normalizeEnumSelection } from '~/lib/util/enum-selection'

export function ownerDocumentListRecordFromCentral(item: OwnerCommercialDocumentListItemDTO): OwnerDocumentListRecord {
  const nullableNumber = (value: string | null) => value === null ? null : Number(value)
  const settlementAmounts = item.amounts.kind === 'sub_settlement' ? item.amounts : null
  const itemAmounts = item.amounts.kind === 'sub_settlement'
    ? { amount: nullableNumber(item.amounts.total), secondaryAmount: null, tertiaryAmount: null }
    : item.amounts.kind === 'owner_change'
      ? {
          amount: nullableNumber(item.amounts.taxInclusive),
          secondaryAmount: nullableNumber(item.amounts.taxExclusive),
          tertiaryAmount: nullableNumber(item.amounts.appliedTaxExclusive),
        }
      : item.amounts.kind === 'sub_change'
        ? {
            amount: nullableNumber(item.amounts.approved),
            secondaryAmount: item.amounts.actualApproved === null ? null : Number(item.amounts.actualApproved),
            tertiaryAmount: 0,
          }
        : item.amounts.kind === 'owner_report'
          ? {
              amount: nullableNumber(item.amounts.reported),
              secondaryAmount: nullableNumber(item.amounts.audited),
              tertiaryAmount: nullableNumber(item.amounts.difference),
            }
          : item.amounts.kind === 'final_settlement'
            ? {
                amount: nullableNumber(item.amounts.declared),
                secondaryAmount: nullableNumber(item.amounts.audited),
                tertiaryAmount: nullableNumber(item.amounts.receiptDifference),
              }
            : (item.amounts.kind === 'owner_penalty' || item.amounts.kind === 'project_penalty')
                ? {
                    amount: nullableNumber(item.amounts.amount),
                    secondaryAmount: 0,
                    tertiaryAmount: 0,
                  }
                : {
                    amount: nullableNumber(item.amounts.contractEstimate),
                    secondaryAmount: 0,
                    tertiaryAmount: 0,
                  }
  const acceptanceFields = item.acceptanceView?.variant === 'acceptance'
    ? {
        viewVariant: 'acceptance' as const,
        acceptanceOrganization: item.acceptanceView.organization,
        acceptancePerson: item.acceptanceView.person,
        acceptanceConclusion: item.acceptanceView.conclusion,
      }
    : item.acceptanceView?.variant === 'warranty'
      ? {
          viewVariant: 'warranty' as const,
          warrantyOwner: item.acceptanceView.owner,
          warrantyStartDate: item.acceptanceView.startDate ?? '',
          warrantyEndDate: item.acceptanceView.endDate ?? '',
          warrantyConfirmationOrganization: item.acceptanceView.confirmationOrganization ?? '',
          warrantyConfirmationDate: item.acceptanceView.confirmationDate ?? '',
          warrantyConfirmationNote: item.acceptanceView.confirmationNote,
        }
      : {}
  return {
    id: item.id,
    no: item.no,
    name: item.name,
    noticeNo: item.ownerPenaltyFacts?.noticeNo,
    projectId: item.project.state === 'resolved' ? item.project.id : null,
    projectName: item.project.state === 'resolved' ? item.project.label : item.recordedRelations?.projectName ?? '',
    contractId: item.contract.state === 'resolved' ? item.contract.id : null,
    contractName: item.contract.state === 'resolved' ? item.contract.label : item.recordedRelations?.contractName ?? '',
    supplierId: item.supplier.state === 'resolved' ? item.supplier.id : null,
    supplierName: item.supplier.state === 'resolved' ? item.supplier.label : item.recordedRelations?.supplierName ?? '',
    crewId: item.crew?.state === 'resolved' ? item.crew.id : null,
    crewName: item.crew?.state === 'resolved' ? item.crew.label : item.recordedRelations?.crewName ?? '',
    type: item.documentType,
    period: item.periodNo,
    ...itemAmounts,
    ...(item.amounts.kind === 'project_penalty' ? { secondaryAmount: Number(item.amounts.deducted), tertiaryAmount: nullableNumber(item.amounts.remaining) } : {}),
    ...(settlementAmounts
      ? Object.fromEntries((['deductions', 'netSettlement', 'cumulativeApplied', 'remainingApplicable', 'cumulativePaid', 'remainingUnpaid'] as const).map((key) => {
          const value = settlementAmounts[key]
          return [key, value == null ? null : Number(value)]
        }))
      : {}),
    projectNavigation: item.projectNavigation,
    contractNavigation: item.contractNavigation,
    supplierNavigation: item.supplierNavigation,
    quantity: item.amounts.kind === 'sub_change' && item.amounts.changedArea != null
      ? Number(item.amounts.changedArea)
      : null,
    date: item.acceptanceView?.variant === 'acceptance'
      ? item.acceptanceView.date ?? ''
      : item.acceptanceView?.variant === 'warranty'
        ? item.acceptanceView.confirmationDate ?? item.acceptanceView.endDate ?? item.acceptanceView.startDate ?? ''
        : item.applicationDate ?? '',
    status: item.status,
    attachmentCount: item.attachmentCount ?? 0,
    ...acceptanceFields,
  }
}

export interface OwnerDocumentListFilters {
  search: string
  project: string
  type: string | string[]
  statusView: string | string[]
  routeProject?: string
  routeContract?: string
  routeSupplier?: string
}

export interface OwnerDocumentListView {
  key: string
  label: string
}

interface OwnerDocumentAmountSummary {
  field: 'amount' | 'secondaryAmount' | 'tertiaryAmount'
  label: string
}

interface OwnerDocumentListConfig {
  columns: KitTableColumn[]
  searchFields: Array<keyof OwnerDocumentListRecord>
  searchPlaceholder: string
  typeLabel: string
  showTypeFilter: boolean
  views: OwnerDocumentListView[]
  defaultView: string
  countLabel: string
  amountSummaries: OwnerDocumentAmountSummary[]
}

const SEQ_COLUMN: KitTableColumn = {
  title: '#',
  type: 'seq',
  width: 54,
  fixed: 'left',
}
const ACTION_COLUMN: KitTableColumn = {
  title: '操作',
  type: 'action',
  width: 56,
}
const PROJECT_COLUMN: KitTableColumn = {
  field: 'projectName',
  title: '项目',
  width: 150,
  slot: 'project',
}
const CONTRACT_COLUMN: KitTableColumn = {
  field: 'contractName',
  title: '关联合同',
  minWidth: 210,
  slot: 'contract',
}
const STATUS_COLUMN: KitTableColumn = {
  field: 'status',
  title: '状态',
  width: 96,
  slot: 'status',
}

export const OWNER_ACCEPTANCE_LIST_COLUMNS: Record<'acceptance' | 'warranty', KitTableColumn[]> = {
  acceptance: [
    SEQ_COLUMN,
    { field: 'no', title: '验收编号', width: 150, fixed: 'left', slot: 'document' },
    { field: 'name', title: '验收项目', minWidth: 210 },
    PROJECT_COLUMN,
    { ...CONTRACT_COLUMN, title: '施工合同' },
    { field: 'acceptanceOrganization', title: '验收单位', minWidth: 200 },
    { field: 'acceptancePerson', title: '验收人', width: 120 },
    { field: 'date', title: '验收日期', type: 'date', width: 116 },
    { field: 'amount', title: '合同估算', type: 'money', width: 142 },
    { field: 'acceptanceConclusion', title: '验收结论', minWidth: 180 },
    { field: 'attachmentCount', title: '附件', width: 82, align: 'right' },
    STATUS_COLUMN,
    ACTION_COLUMN,
  ],
  warranty: [
    SEQ_COLUMN,
    { field: 'no', title: '验收编号', width: 150, fixed: 'left', slot: 'document' },
    { field: 'name', title: '保修项目', minWidth: 210 },
    PROJECT_COLUMN,
    { ...CONTRACT_COLUMN, title: '施工合同' },
    { field: 'warrantyOwner', title: '保修责任单位', minWidth: 190 },
    { field: 'warrantyStartDate', title: '保修开始', type: 'date', width: 116 },
    { field: 'warrantyEndDate', title: '保修结束', type: 'date', width: 116 },
    { field: 'warrantyConfirmationOrganization', title: '到期验收单位', minWidth: 180 },
    { field: 'warrantyConfirmationDate', title: '确认日期', type: 'date', width: 116 },
    { field: 'amount', title: '合同估算', type: 'money', width: 142 },
    { field: 'warrantyConfirmationNote', title: '到期确认说明', minWidth: 190 },
    { field: 'attachmentCount', title: '附件', width: 82, align: 'right' },
    STATUS_COLUMN,
    ACTION_COLUMN,
  ],
}

export const OWNER_ACCEPTANCE_LIST_VIEWS: Record<'acceptance' | 'warranty', OwnerDocumentListView[]> = {
  acceptance: [
    { key: 'all', label: '全部' },
    { key: 'checking', label: '验收中' },
    { key: 'accepted', label: '已验收' },
    { key: 'warranty', label: '保修中' },
    { key: 'expired', label: '已到期' },
  ],
  warranty: [
    { key: 'all', label: '全部' },
    { key: 'warranty', label: '保修中' },
    { key: 'expired', label: '已到期' },
  ],
}

export const OWNER_DOCUMENT_LIST_CONFIG: Record<OwnerDocumentKind, OwnerDocumentListConfig> = {
  owner_change: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '变更编号', width: 150, fixed: 'left', slot: 'document' },
      { field: 'name', title: '变更名称', minWidth: 210 },
      PROJECT_COLUMN,
      { ...CONTRACT_COLUMN, title: '施工合同' },
      { field: 'type', title: '类型', width: 104, slot: 'type' },
      { field: 'amount', title: '含税审定金额', type: 'money', width: 142 },
      { field: 'secondaryAmount', title: '无税审定金额', type: 'money', width: 142 },
      { field: 'tertiaryAmount', title: '无税申报金额', type: 'money', width: 142 },
      { field: 'date', title: '申报/审定日期', type: 'date', width: 126 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'projectName', 'contractName', 'acceptanceConclusion', 'warrantyConfirmationNote'],
    searchPlaceholder: '搜索变更编号 / 名称 / 施工合同',
    typeLabel: '类型',
    showTypeFilter: true,
    views: [
      { key: 'all', label: '全部' },
      { key: 'approved', label: '已签证' },
      { key: 'submitted', label: '已上报' },
      { key: 'rejected', label: '已打回' },
      { key: 'draft', label: '草稿' },
    ],
    defaultView: 'approved',
    countLabel: '变更单数',
    amountSummaries: [
      { field: 'amount', label: '含税审定金额总和' },
      { field: 'tertiaryAmount', label: '无税申报金额总和' },
    ],
  },
  owner_report: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '报量编号', width: 150, fixed: 'left', slot: 'document' },
      PROJECT_COLUMN,
      { ...CONTRACT_COLUMN, title: '施工合同' },
      { field: 'period', title: '期数', width: 100 },
      { field: 'amount', title: '申报产值', type: 'money', width: 142 },
      { field: 'secondaryAmount', title: '审定金额', type: 'money', width: 142 },
      { field: 'tertiaryAmount', title: '审定差额', type: 'money', width: 142 },
      { field: 'date', title: '申报日期', type: 'date', width: 116 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'period', 'projectName', 'contractName'],
    searchPlaceholder: '搜索报量编号 / 期数 / 施工合同',
    typeLabel: '类型',
    showTypeFilter: false,
    views: [
      { key: 'all', label: '全部' },
      { key: 'reported', label: '已申报' },
      { key: 'audited', label: '已审定' },
    ],
    defaultView: 'reported',
    countLabel: '报量单数',
    amountSummaries: [
      { field: 'amount', label: '申报产值总和' },
      { field: 'secondaryAmount', label: '审定金额总和' },
    ],
  },
  acceptance: {
    columns: OWNER_ACCEPTANCE_LIST_COLUMNS.acceptance,
    searchFields: ['no', 'name', 'projectName', 'contractName'],
    searchPlaceholder: '搜索单据编号 / 名称 / 项目',
    typeLabel: '类型',
    showTypeFilter: false,
    views: OWNER_ACCEPTANCE_LIST_VIEWS.acceptance,
    defaultView: 'all',
    countLabel: '生命周期记录数',
    amountSummaries: [{ field: 'amount', label: '合同估算金额总和' }],
  },
  final_settlement: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '结算编号', width: 150, fixed: 'left', slot: 'document' },
      { field: 'name', title: '结算名称', minWidth: 230 },
      PROJECT_COLUMN,
      { ...CONTRACT_COLUMN, title: '施工合同' },
      { field: 'amount', title: '结算金额', type: 'money', width: 142 },
      { field: 'date', title: '报审日期', type: 'date', width: 116 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'projectName', 'contractName'],
    searchPlaceholder: '搜索结算编号 / 名称 / 施工合同',
    typeLabel: '类型',
    showTypeFilter: false,
    views: [
      { key: 'doing', label: '进行中' },
      { key: 'done', label: '已审定' },
      { key: 'all', label: '全部' },
    ],
    defaultView: 'doing',
    countLabel: '结算单数',
    amountSummaries: [{ field: 'amount', label: '结算金额总和' }],
  },
  owner_penalty: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '罚扣编号', width: 150, fixed: 'left', slot: 'document' },
      { field: 'name', title: '罚扣事由', minWidth: 230 },
      PROJECT_COLUMN,
      { ...CONTRACT_COLUMN, title: '施工合同' },
      { field: 'amount', title: '罚扣金额', width: 142, align: 'right', slot: 'negativeAmount' },
      { field: 'date', title: '日期', type: 'date', width: 116 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'noticeNo', 'projectName', 'contractName'],
    searchPlaceholder: '搜索罚扣编号 / 事由 / 施工合同',
    typeLabel: '类型',
    showTypeFilter: false,
    views: [
      { key: 'all', label: '全部' },
      { key: 'draft', label: '草稿' },
      { key: 'submitted', label: '已提交' },
    ],
    defaultView: 'all',
    countLabel: '罚扣单数',
    amountSummaries: [{ field: 'amount', label: '罚扣金额总和' }],
  },
  sub_change: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '变更编号', width: 150, fixed: 'left', slot: 'document' },
      { field: 'type', title: '类型', width: 104, slot: 'type' },
      PROJECT_COLUMN,
      CONTRACT_COLUMN,
      { field: 'supplierName', title: '乙方（分供方）', minWidth: 180, slot: 'supplier' },
      { field: 'amount', title: '审批金额', type: 'money', width: 132 },
      { field: 'quantity', title: '变更面积', width: 112, align: 'right' },
      { field: 'secondaryAmount', title: '实际审定价', type: 'money', width: 132 },
      { field: 'date', title: '日期', type: 'date', width: 116 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'type', 'projectName', 'contractName', 'supplierName'],
    searchPlaceholder: '搜索变更编号 / 类型 / 分供方',
    typeLabel: '类型',
    showTypeFilter: true,
    views: [
      { key: 'all', label: '全部' },
      { key: 'approved', label: '已审批' },
      { key: 'submitted', label: '已提交' },
      { key: 'draft', label: '草稿' },
      { key: 'rejected', label: '已退回' },
    ],
    defaultView: 'all',
    countLabel: '变更单数',
    amountSummaries: [
      { field: 'amount', label: '审批金额总和' },
      { field: 'secondaryAmount', label: '实际审定价总和' },
    ],
  },
  sub_settlement: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '结算编号', width: 150, fixed: 'left', slot: 'document' },
      { field: 'name', title: '结算名称', minWidth: 230 },
      PROJECT_COLUMN,
      CONTRACT_COLUMN,
      { field: 'supplierName', title: '乙方（分供方）', minWidth: 180, slot: 'supplier' },
      { field: 'type', title: '结算类型', width: 112, slot: 'type' },
      { field: 'amount', title: '含税结算额', type: 'money', width: 142 },
      { field: 'deductions', title: '奖罚抵扣', type: 'money', width: 142 },
      { field: 'netSettlement', title: '本次结算净额', type: 'money', width: 142 },
      { field: 'cumulativeApplied', title: '累计申请付款', type: 'money', width: 142 },
      { field: 'remainingApplicable', title: '剩余可申请', type: 'money', width: 142 },
      { field: 'cumulativePaid', title: '累计已付', type: 'money', width: 142 },
      { field: 'remainingUnpaid', title: '剩余未付', type: 'money', width: 142 },
      { field: 'date', title: '结算日期', type: 'date', width: 116 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'type', 'projectName', 'contractName', 'supplierName'],
    searchPlaceholder: '搜索结算编号 / 名称 / 分供方',
    typeLabel: '结算类型',
    showTypeFilter: true,
    views: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待确认' },
      { key: 'confirmed', label: '已确认' },
    ],
    defaultView: 'pending',
    countLabel: '结算单数',
    amountSummaries: [{ field: 'amount', label: '结算金额总和' }],
  },
  project_penalty: {
    columns: [
      SEQ_COLUMN,
      { field: 'no', title: '罚扣编号', width: 150, fixed: 'left', slot: 'document' },
      { field: 'name', title: '罚扣事由', minWidth: 220 },
      PROJECT_COLUMN,
      CONTRACT_COLUMN,
      { field: 'supplierName', title: '乙方', minWidth: 180, slot: 'supplier' },
      { field: 'amount', title: '罚扣金额', type: 'money', width: 142 },
      { field: 'secondaryAmount', title: '累计已抵扣', type: 'money', width: 142 },
      { field: 'tertiaryAmount', title: '剩余可抵扣', type: 'money', width: 142 },
      { field: 'type', title: '抵扣方式', width: 120 },
      { field: 'date', title: '日期', type: 'date', width: 116 },
      STATUS_COLUMN,
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'projectName', 'contractName', 'supplierName', 'crewName'],
    searchPlaceholder: '搜索罚扣编号 / 事由 / 责任对象',
    typeLabel: '类型',
    showTypeFilter: false,
    views: [
      { key: 'all', label: '全部' },
      { key: 'draft', label: '草稿' },
      { key: 'pending', label: '待抵扣' },
      { key: 'done', label: '已抵扣' },
    ],
    defaultView: 'pending',
    countLabel: '罚扣单数',
    amountSummaries: [{ field: 'amount', label: '罚扣金额总和' }],
  },
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN')
}

export function ownerDocumentStatusViewKey(
  kind: OwnerDocumentKind,
  status: string,
): string {
  const value = normalized(status)
  if (kind === 'owner_report') {
    if (['adjusted', 'reported'].includes(value))
      return 'reported'
    if (['exported', 'audited'].includes(value))
      return 'audited'
  }
  if (kind === 'acceptance') {
    if (value === 'submitted')
      return 'checking'
    if (['accepted', 'warranty', 'expired'].includes(value))
      return value
  }
  if (kind === 'final_settlement')
    return ['audited', 'approved', 'confirmed'].includes(value) ? 'done' : 'doing'
  if (kind === 'sub_settlement') {
    if (['confirmed', '已确认'].includes(value))
      return 'confirmed'
    if (['draft', 'pending', 'submitted', '待确认', '草稿'].includes(value))
      return 'pending'
  }
  if (kind === 'project_penalty') {
    if (value === 'draft')
      return 'draft'
    return value === 'deducted' ? 'done' : 'pending'
  }
  return value
}

export function filterOwnerDocumentRows(
  kind: OwnerDocumentKind,
  rows: readonly OwnerDocumentListRecord[],
  filters: OwnerDocumentListFilters,
): OwnerDocumentListRecord[] {
  const config = OWNER_DOCUMENT_LIST_CONFIG[kind]
  const keyword = normalized(filters.search)
  return rows.filter((row) => {
    if (filters.project !== 'all' && row.projectId !== filters.project)
      return false
    const types = normalizeEnumSelection(filters.type)
    const statuses = normalizeEnumSelection(filters.statusView)
    if (types.length && !types.includes(row.type))
      return false
    if (
      statuses.length
      && !statuses.includes(ownerDocumentStatusViewKey(kind, row.status))
    ) {
      return false
    }
    if (filters.routeProject && row.projectId !== filters.routeProject)
      return false
    if (filters.routeContract && row.contractId !== filters.routeContract)
      return false
    if (filters.routeSupplier && row.supplierId !== filters.routeSupplier)
      return false
    if (!keyword)
      return true
    return config.searchFields.some(field => normalized(row[field]).includes(keyword))
  })
}

export function ownerDocumentStatusLabelForList(
  kind: OwnerDocumentKind,
  status: string,
): string {
  const view = ownerDocumentStatusViewKey(kind, status)
  const labels: Partial<Record<OwnerDocumentKind, Record<string, string>>> = {
    owner_change: {
      draft: '草稿',
      submitted: '已上报',
      rejected: '已打回',
      approved: '已签证',
    },
    owner_report: { draft: '草稿', reported: '已申报', audited: '已审定' },
    acceptance: {
      draft: '草稿',
      checking: '验收中',
      accepted: '已验收',
      warranty: '保修中',
      expired: '已到期',
    },
    final_settlement: {
      doing: normalized(status) === 'draft' ? '编制中' : '已报审',
      done: '已审定',
    },
    owner_penalty: {
      draft: '草稿',
      submitted: '已提交',
    },
    sub_change: {
      draft: '草稿',
      submitted: '已提交',
      rejected: '已退回',
      approved: '已审批',
    },
    sub_settlement: {
      pending: ['draft', '草稿'].includes(normalized(status)) ? '草稿' : '待确认',
      confirmed: '已确认',
    },
    project_penalty: {
      draft: '草稿',
      pending: {
        repairing: '整改中',
        repaired_self: '自行整改',
        repaired_other: '代为整改',
      }[normalized(status)] ?? '待抵扣',
      done: '已抵扣',
    },
  }
  return labels[kind]?.[view] ?? status
}

export function ownerDocumentStatusClass(
  kind: OwnerDocumentKind,
  status: string,
): string {
  const view = ownerDocumentStatusViewKey(kind, status)
  if (['rejected'].includes(view))
    return 'chip-danger'
  if (['submitted', 'reported', 'checking', 'appealing', 'pending'].includes(view))
    return 'chip-warn'
  if (['approved', 'audited', 'done', 'confirmed', 'accepted', 'expired'].includes(view))
    return 'chip-ok'
  if (view === 'warranty')
    return 'chip-brand'
  return 'chip bg-surface-3 text-ink-faint'
}

export function ownerDocumentTypeLabel(kind: OwnerDocumentKind, type: string): string {
  if (kind === 'owner_change') {
    return {
      change_negotiation: '变更洽商',
      site_visa: '现场签证',
      claim: '索赔',
      material_price_approval: '材料认价',
    }[type] ?? type
  }
  if (kind === 'acceptance')
    return type === 'warranty' ? '保修到期确认' : '竣工验收'
  return type
}
