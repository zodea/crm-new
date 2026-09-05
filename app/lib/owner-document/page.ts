import type { BoqChangeOperation } from '~/lib/boq/read-model'
import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
  OwnerDocumentKind,
} from '~/lib/owner-document/forms'
import { calculateBoqChangeLine } from '~/lib/boq/change-calculation'

export type { OwnerDocumentBoqLine }

export interface OwnerDocumentMeta {
  label: string
  subtitle: string
  listPath: string
  contractListPath: string
  contractListLabel: string
  routeScope: 'owner' | 'subcontract' | 'project'
  routeKind: string
  postLabel: string
  postMessage: string
  sections: Array<{ key: string, label: string }>
}

export const OWNER_DOCUMENT_META: Record<OwnerDocumentKind, OwnerDocumentMeta> = {
  owner_change: {
    label: '甲方变洽签',
    subtitle: '变更洽商、现场签证与指令闭环',
    listPath: '/owner/change',
    contractListPath: '/contract/construction',
    contractListLabel: '施工合同列表',
    routeScope: 'owner',
    routeKind: 'change',
    postLabel: '保存并上报',
    postMessage: '上报后可执行甲方签证，签证生效后将锁定量价与收入变更台账。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'lines', label: '变更明细' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  owner_report: {
    label: '甲方报量',
    subtitle: '合同清单自动完成量、申报量与审定量',
    listPath: '/owner/report',
    contractListPath: '/contract/construction',
    contractListLabel: '施工合同列表',
    routeScope: 'owner',
    routeKind: 'report',
    postLabel: '保存并申报',
    postMessage: '申报后保留自动完成量快照，并进入甲方审定流程。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'lines', label: '报量明细' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  acceptance: {
    label: '竣工验收·保修',
    subtitle: '同一验收记录的竣工验收与保修到期双视图',
    listPath: '/owner/acceptance',
    contractListPath: '/contract/construction',
    contractListLabel: '施工合同列表',
    routeScope: 'owner',
    routeKind: 'acceptance',
    postLabel: '保存并提交',
    postMessage: '提交后进入验收流程；验收、保修和到期确认均通过独立命令留痕。',
    sections: [
      { key: 'basic', label: '验收信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  final_settlement: {
    label: '最终结算',
    subtitle: '施工合同最终报审及收款差额',
    listPath: '/owner/final-settlement',
    contractListPath: '/contract/construction',
    contractListLabel: '施工合同列表',
    routeScope: 'owner',
    routeKind: 'final-settlement',
    postLabel: '保存并提交',
    postMessage: '提交后将作为甲方最终结算事实保留。',
    sections: [
      { key: 'basic', label: '结算信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  owner_penalty: {
    label: '甲方罚扣单',
    subtitle: '甲方对我方罚款、扣款与申诉说明',
    listPath: '/owner/penalty',
    contractListPath: '/contract/construction',
    contractListLabel: '施工合同列表',
    routeScope: 'owner',
    routeKind: 'penalty',
    postLabel: '保存并提交',
    postMessage: '提交后该罚扣单进入正式台账。',
    sections: [
      { key: 'basic', label: '罚扣信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  sub_change: {
    label: '分包变洽签',
    subtitle: '分包增项、签证与审批金额',
    listPath: '/subcontract/change',
    contractListPath: '/contract/subcontract',
    contractListLabel: '分包合同列表',
    routeScope: 'subcontract',
    routeKind: 'change',
    postLabel: '保存并提交',
    postMessage: '提交后该分包变更进入审批台账。',
    sections: [
      { key: 'basic', label: '变更信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  sub_settlement: {
    label: '分包结算',
    subtitle: '结算记录 · 累计金额 · 付款余额',
    listPath: '/subcontract/settlement',
    contractListPath: '/contract/subcontract',
    contractListLabel: '分包合同列表',
    routeScope: 'subcontract',
    routeKind: 'settlement',
    postLabel: '保存并确认',
    postMessage: '确认后该记录进入支出结算事实，可供项目罚扣抵扣。',
    sections: [
      { key: 'basic', label: '结算信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  project_penalty: {
    label: '项目罚扣',
    subtitle: '班组、分供方罚扣及结算抵扣闭环',
    listPath: '/project/penalty',
    contractListPath: '/contract/subcontract',
    contractListLabel: '分包合同列表',
    routeScope: 'project',
    routeKind: 'penalty',
    postLabel: '保存并提交',
    postMessage: '提交后可选择分包结算执行真实抵扣。',
    sections: [
      { key: 'basic', label: '罚扣信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
}

export function ownerDocumentLocalDate(
  now: Pick<Date, 'getFullYear' | 'getMonth' | 'getDate'> = new Date(),
): string {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-')
}

export function ownerDocumentDefaults(kind: OwnerDocumentKind): OwnerDocumentDraft {
  const base: OwnerDocumentDraft = {
    no: '',
    status: 'draft',
    note: '',
    projectId: null,
    contractId: null,
  }
  switch (kind) {
    case 'owner_change':
      return {
        ...base,
        name: '',
        documentType: 'change_negotiation',
        directiveNo: '',
        directiveType: '',
        applicationDate: ownerDocumentLocalDate(),
        reason: '',
        lines: [],
      }
    case 'owner_report':
      return {
        ...base,
        periodNo: ownerDocumentLocalDate().slice(0, 7),
        applicationDate: ownerDocumentLocalDate(),
        lines: [],
      }
    case 'acceptance':
      return {
        ...base,
        name: '',
        applicationDate: ownerDocumentLocalDate(),
        acceptanceOrganization: '',
        acceptancePerson: '',
        acceptanceDate: null,
        acceptanceConclusion: '',
        warrantyOwner: '',
        warrantyStartDate: null,
        warrantyEndDate: null,
        warrantyConfirmationOrganization: null,
        warrantyConfirmationDate: null,
        warrantyConfirmationNote: '',
        lifecycleEvents: [],
      }
    case 'final_settlement':
      return {
        ...base,
        name: '',
        settlementAmount: null,
        submissionDate: ownerDocumentLocalDate(),
        basis: '',
        differenceNote: '',
      }
    case 'owner_penalty':
      return {
        ...base,
        noticeNo: '',
        amount: null,
        penaltyDate: ownerDocumentLocalDate(),
        reason: '',
        appealNote: '',
      }
    case 'sub_change':
      return {
        ...base,
        supplierId: null,
        changeType: '增项',
        changeDate: ownerDocumentLocalDate(),
        approvedAmount: null,
        changedArea: null,
        actualApprovedPrice: null,
        reason: '',
      }
    case 'sub_settlement':
      return {
        ...base,
        supplierId: null,
        name: '',
        settlementType: '过程结算',
        totalAmount: null,
        settlementDate: ownerDocumentLocalDate(),
        deductionNote: '',
      }
    case 'project_penalty':
      return {
        ...base,
        supplierId: null,
        crewId: null,
        penaltyDate: ownerDocumentLocalDate(),
        reason: '',
        amount: null,
        deductionMethod: '结算抵扣',
        deadline: '',
        rectificationNote: '',
      }
  }
}

export function ownerDocumentFormPath(kind: OwnerDocumentKind, id?: string): string {
  const listPath = OWNER_DOCUMENT_META[kind].listPath
  const centralReadOnly = kind === 'owner_change' || kind === 'owner_report'
    || kind === 'acceptance' || kind === 'final_settlement' || kind === 'owner_penalty' || kind === 'sub_change' || kind === 'sub_settlement'
  return id && centralReadOnly ? `${listPath}/form/${id}` : id ? `${listPath}/${id}` : `${listPath}/new`
}

export function ownerDocumentDetailPath(
  kind: OwnerDocumentKind,
  id: string,
  origin: 'real' | 'demo' = 'real',
  variant?: 'acceptance' | 'warranty',
): string {
  if (kind !== 'owner_change' && kind !== 'owner_report'
    && kind !== 'acceptance' && kind !== 'final_settlement' && kind !== 'owner_penalty' && kind !== 'sub_change' && kind !== 'sub_settlement') {
    throw new Error('该甲方单据类型尚无中央只读详情')
  }
  const query = new URLSearchParams({ origin })
  if (kind === 'acceptance')
    query.set('variant', variant ?? 'acceptance')
  return `${OWNER_DOCUMENT_META[kind].listPath}/${encodeURIComponent(id)}?${query.toString()}`
}

export function ownerDocumentKindFromRoute(
  scope: string,
  routeKind: string,
): OwnerDocumentKind | null {
  const entry = Object.entries(OWNER_DOCUMENT_META).find(([, meta]) =>
    meta.routeScope === scope && meta.routeKind === routeKind,
  )
  return entry?.[0] as OwnerDocumentKind | undefined ?? null
}

export function validateOwnerDocumentForm(
  kind: OwnerDocumentKind,
  draft: OwnerDocumentDraft,
  boqLines: OwnerDocumentBoqLine[] = [],
): Record<string, string> {
  const errors: Record<string, string> = {}
  const require = (field: string, label: string, positive = false) => {
    const value = draft[field]
    const missing = positive
      ? !(Number(value) > 0)
      : typeof value === 'string' ? !value.trim() : value == null
    if (missing)
      errors[field] = `${label}为必填项`
  }

  switch (kind) {
    case 'owner_change':
      require('name', '变更名称')
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('applicationDate', '申报日期')
      require('reason', '变更事由')
      if (!(draft.lines?.length) && !(
        Number(draft.approvedTaxInclusiveAmount) > 0
        || Number(draft.approvedTaxExclusiveAmount) > 0
      )) {
        errors.lines = '至少填写一条量价变更，或填写纯金额签证金额'
      }
      else if (draft.lines?.length) {
        const effective = new Map(boqLines.map(line => [line.id, {
          effectiveQty: line.qty,
          effectiveUnitPrice: line.unitPrice,
        }]))
        for (const [index, line] of draft.lines.entries()) {
          const operation = String(line.operation ?? '')
          if (!['add', 'qty', 'price'].includes(operation)) {
            errors.lines = `第 ${index + 1} 行：请选择有效的变更操作`
            break
          }
          if (operation === 'add' && !String(line.itemName ?? '').trim()) {
            errors.lines = `第 ${index + 1} 行：新增 BOQ 项必须填写分项名称`
            break
          }
          const boqLineId = String(line.boqLineId ?? '')
          const target = operation === 'add' ? null : effective.get(boqLineId)
          if (operation !== 'add' && (!boqLineId || !target)) {
            errors.lines = `第 ${index + 1} 行：调量或调价必须选择有效 BOQ 行`
            break
          }
          try {
            const calculated = calculateBoqChangeLine(
              operation as BoqChangeOperation,
              target ?? null,
              line.deltaQty == null || line.deltaQty === '' ? null : Number(line.deltaQty),
              line.newUnitPrice == null || line.newUnitPrice === '' ? null : Number(line.newUnitPrice),
            )
            if (target) {
              if (operation === 'qty')
                target.effectiveQty += calculated.deltaQty ?? 0
              if (operation === 'price' && calculated.newUnitPrice != null)
                target.effectiveUnitPrice = calculated.newUnitPrice
            }
          }
          catch (cause) {
            errors.lines = `第 ${index + 1} 行：${cause instanceof Error ? cause.message : '变更量价无效'}`
            break
          }
        }
      }
      break
    case 'owner_report':
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('periodNo', '报量期次')
      require('applicationDate', '申报日期')
      if (!draft.lines?.length) {
        errors.lines = '至少填写一条报量明细'
      }
      else {
        const boqLineIds = draft.lines.map(line => String(line.boqLineId ?? ''))
        const invalidIndex = draft.lines.findIndex((line) => {
          const id = String(line.boqLineId ?? '')
          const source = boqLines.find(candidate => candidate.id === id)
          const reportedQty = line.reportedQty == null || line.reportedQty === ''
            ? source?.autoQty
            : Number(line.reportedQty)
          return !id || !source || reportedQty == null || !Number.isFinite(reportedQty) || reportedQty < 0
        })
        if (invalidIndex >= 0) {
          const line = draft.lines[invalidIndex]!
          const id = String(line.boqLineId ?? '')
          const source = boqLines.find(candidate => candidate.id === id)
          const reportedQty = line.reportedQty == null || line.reportedQty === ''
            ? source?.autoQty
            : Number(line.reportedQty)
          errors.lines = !id || !source
            ? `第 ${invalidIndex + 1} 行：请选择有效 BOQ 行`
            : reportedQty != null && Number.isFinite(reportedQty) && reportedQty < 0
              ? `第 ${invalidIndex + 1} 行：申报量不能为负数`
              : `第 ${invalidIndex + 1} 行：请填写有效申报量`
        }
        else if (new Set(boqLineIds).size !== boqLineIds.length) {
          errors.lines = '同一月度报量不能重复选择 BOQ 行'
        }
      }
      break
    case 'acceptance':
      require('name', '名称')
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('applicationDate', '申报日期')
      break
    case 'final_settlement':
      require('name', '结算名称')
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('settlementAmount', '结算金额', true)
      require('submissionDate', '报审日期')
      break
    case 'owner_penalty':
      require('projectId', '项目')
      require('contractId', '施工合同')
      require('amount', '罚扣金额', true)
      require('penaltyDate', '罚扣日期')
      require('reason', '罚扣事由')
      break
    case 'sub_change':
      require('projectId', '项目')
      require('supplierId', '分供方')
      require('contractId', '支出合同')
      require('changeDate', '变更日期')
      require('approvedAmount', '审批金额', true)
      require('reason', '变更事由')
      break
    case 'sub_settlement':
      require('name', '结算名称')
      require('projectId', '项目')
      require('supplierId', '分供方')
      require('contractId', '支出合同')
      require('totalAmount', '结算金额', true)
      require('settlementDate', '结算日期')
      break
    case 'project_penalty':
      require('projectId', '项目')
      require('amount', '罚扣金额', true)
      require('penaltyDate', '罚扣日期')
      require('reason', '罚扣事由')
      break
  }

  return errors
}

export function ownerDocumentStatusLabel(status: string): string {
  return {
    draft: '草稿',
    submitted: '已提交',
    adjusted: '已申报',
    reported: '已申报',
    exported: '已审定',
    audited: '已审定',
    approved: '已签证',
    accepted: '已验收',
    warranty: '保修中',
    expired: '保修到期',
    confirmed: '已确认',
    pending: '待抵扣',
    repairing: '整改中',
    repaired_self: '自行整改',
    repaired_other: '代为整改',
    deducted: '已抵扣',
    rejected: '已退回',
  }[status] ?? status
}

export function ownerDocumentLineAmount(
  kind: OwnerDocumentKind,
  line: Record<string, unknown>,
): number {
  if (kind === 'owner_report')
    return (Number(line.reportedQty) || 0) * (Number(line.unitPrice) || 0)
  const operation = String(line.operation ?? 'qty')
  const qty = Number(line.qty) || 0
  const deltaQty = Number(line.deltaQty) || 0
  const unitPrice = Number(line.unitPrice) || 0
  const newUnitPrice = Number(line.newUnitPrice) || 0
  if (operation === 'add')
    return deltaQty * newUnitPrice
  if (operation === 'price')
    return qty * (newUnitPrice - unitPrice)
  return deltaQty * unitPrice
}
