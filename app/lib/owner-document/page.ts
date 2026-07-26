import type {
  OwnerDocumentBoqLine,
  OwnerDocumentDraft,
  OwnerDocumentKind,
} from '~/lib/owner-document/forms'

export type { OwnerDocumentBoqLine }

export interface OwnerDocumentMeta {
  label: string
  subtitle: string
  listPath: string
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
    subtitle: '验收、移交与保修责任归档',
    listPath: '/owner/acceptance',
    routeScope: 'owner',
    routeKind: 'acceptance',
    postLabel: '保存并提交',
    postMessage: '提交后该验收或保修记录进入正式归档。',
    sections: [
      { key: 'basic', label: '验收信息' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
  final_settlement: {
    label: '最终结算',
    subtitle: '施工合同最终报审及收款差额',
    listPath: '/owner/final-settlement',
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
    subtitle: '复用支出结算事实的分包结算单',
    listPath: '/subcontract/settlement',
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

function today(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
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
        applicationDate: today(),
        reason: '',
        lines: [],
      }
    case 'owner_report':
      return {
        ...base,
        periodNo: today().slice(0, 7),
        applicationDate: today(),
        lines: [],
      }
    case 'acceptance':
      return {
        ...base,
        type: 'acceptance',
        name: '',
        documentDate: today(),
        acceptor: '',
        warrantyOwner: '',
        conclusion: '',
      }
    case 'final_settlement':
      return {
        ...base,
        name: '',
        settlementAmount: null,
        submissionDate: today(),
        basis: '',
        differenceNote: '',
      }
    case 'owner_penalty':
      return {
        ...base,
        noticeNo: '',
        amount: null,
        penaltyDate: today(),
        reason: '',
        appealNote: '',
      }
    case 'sub_change':
      return {
        ...base,
        supplierId: null,
        changeType: '增项',
        changeDate: today(),
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
        settlementDate: today(),
        deductionNote: '',
      }
    case 'project_penalty':
      return {
        ...base,
        supplierId: null,
        crewId: null,
        penaltyDate: today(),
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
  return id ? `${listPath}/${id}` : `${listPath}/new`
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
