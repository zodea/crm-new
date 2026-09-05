import type {
  SubcontractContractDetailSource,
  SubcontractContractFactSource,
  SubcontractContractFactSources,
} from '../../app/lib/subcontract-contract/repository'
import contractsSeed from '../../app/lib/db/seed/contracts.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import suppliersSeed from '../../app/lib/db/seed/suppliers.json'
import {
  buildSubcontractContractDetail,
  buildSubcontractContractListPage,
  parseSubcontractContractDetailQuery,
  parseSubcontractContractListQuery,
  subcontractContractProblem,
  SubcontractContractRepositoryProblem,
} from '../../app/lib/subcontract-contract/repository'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { subcontractContractCommandTestInstance } from './subcontract-contract-command-test-instance'

export type SubcontractContractReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-25T00:00:00.000Z'
const projects = new Map(projectsSeed.map(row => [row.id, row.name]))
const suppliers = new Map(suppliersSeed.map(row => [row.id, row.name]))

const demoContracts: SubcontractContractDetailSource[] = contractsSeed
  .filter(row => row.kind === '分包')
  .map(row => ({
    dataOrigin: 'demo',
    id: row.id,
    no: row.no,
    name: row.name,
    kind: row.kind,
    subKind: row.sub_kind,
    projectId: row.project_id,
    projectName: projects.get(row.project_id ?? '') ?? '',
    projectPermission: 'allowed',
    supplierId: row.supplier_id,
    supplierName: suppliers.get(row.supplier_id ?? '') ?? '',
    supplierPermission: 'allowed',
    amount: Number(row.amount ?? 0),
    settlementStatus: null,
    clearanceStatus: null,
    content: row.name.replace(/合同$/, ''),
    invoiceType: '增值税专用发票',
    contactName: '项目商务联系人',
    contactPhone: '13800000321',
    taxRate: 0.03,
    signDate: row.sign_date || null,
    mainTerms: '按合同约定的实际完成事实计量。',
    paymentTerms: '按已确认结算和票款关系付款。',
    warrantyTerms: '',
    retentionRatio: null,
    retentionAmount: null,
    retentionDays: null,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

function fact(id: string, no: string, name: string, amount: number | null, date: string, status: string, extra: Partial<SubcontractContractFactSource> = {}): SubcontractContractFactSource {
  return { dataOrigin: 'demo', id, contractId: 'con_demo_fb01', no, name, amount, date, status, ...extra }
}

const demoFacts: SubcontractContractFactSources = {
  supplements: [fact('sub-supplement-1', 'FB-BC-001', '劳务范围补充协议', 178000, '2026-02-01', '生效')],
  changes: [fact('sub-change-1', 'FB-BG-001', '样板层范围调整', 38000, '2026-03-10', '已提交')],
  invoices: [fact('sub-invoice-1', 'FP-321-001', '劳务收票登记', 1050000, '2026-06-10', '已归档')],
  paymentApplications: [fact('sub-application-1', 'FK-321-001', '五月进度付款申请', 980000, '2026-06-12', '已审批')],
  paymentRecords: [fact('sub-payment-1', 'ZF-321-001', '五月劳务支付', 980000, '2026-06-15', '已确认')],
  settlements: [
    fact('sub-settlement-1', 'JS-321-001', '五月过程结算', 1040000, '2026-06-05', '已确认', { settlementKind: 'progress' }),
    fact('sub-settlement-2', 'JS-321-002', '样板层完工结算', 200000, '2026-07-05', '已确认', { settlementKind: 'completion' }),
  ],
  penalties: [fact('sub-penalty-1', 'FK-321-001', '现场整改罚扣', 1000, '2026-05-20', '待抵扣')],
  files: [],
}

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new SubcontractContractRepositoryProblem({ ...subcontractContractProblem(code, message, retryable), traceId: `subcontract-contract-test-${code}` })
}

interface SubcontractChangeFactSource {
  rows: (sessionId?: string | null) => readonly {
    dataOrigin: 'demo' | 'real'
    kind: string
    id: string
    contractId: string | null
    no: string
    name: string
    amount: number
    applicationDate: string | null
    status: string
    documentType?: string
  }[]
  sourceVersion: (sessionId?: string | null) => string
}

function subcontractChangeStatusLabel(status: string): string {
  return ({ draft: '草稿', submitted: '已提交', rejected: '已退回', approved: '已审批' } as Record<string, string>)[status] ?? status
}

export function createSubcontractContractReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  commandInstance = subcontractContractCommandTestInstance,
  ownerDocumentSource: SubcontractChangeFactSource = ownerCommercialDocumentCommandTestInstance,
) {
  const scenarios = new Map<string, SubcontractContractReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无分包合同查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '分包合同中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes('subcontract-contract:read'))
      throw problem('forbidden', '无分包合同查看权限')
    const formalRows = commandInstance.rows()
    const formalFacts = commandInstance.facts()
    const formalChanges: SubcontractContractFactSource[] = ownerDocumentSource.rows(sessionId)
      .filter(row => row.dataOrigin === 'real' && row.kind === 'sub_change')
      .map(row => ({
        dataOrigin: row.dataOrigin,
        id: row.id,
        contractId: row.contractId,
        no: row.no,
        name: row.name,
        amount: row.amount,
        date: row.applicationDate,
        status: subcontractChangeStatusLabel(row.status),
      }))
    const formalSettlements: SubcontractContractFactSource[] = ownerDocumentSource.rows(sessionId)
      .filter(row => row.dataOrigin === 'real' && row.kind === 'sub_settlement')
      .map(row => ({ dataOrigin: row.dataOrigin, id: row.id, contractId: row.contractId, no: row.no, name: row.name, amount: row.amount, date: row.applicationDate, status: row.status === 'confirmed' ? '已确认' : '草稿', settlementKind: row.documentType === '最终结算' || row.documentType === '完工结算' ? 'completion' : 'progress' }))
    const combinedFacts = {
      ...formalFacts,
      settlements: formalSettlements,
      changes: [...formalFacts.changes, ...formalChanges],
    }
    return {
      contracts: scenario === 'empty' ? formalRows : [...formalRows, ...demoContracts],
      facts: scenario === 'empty'
        ? combinedFacts
        : {
            supplements: [...formalFacts.supplements, ...demoFacts.supplements],
            changes: [...combinedFacts.changes, ...demoFacts.changes],
            invoices: [...formalFacts.invoices, ...demoFacts.invoices],
            paymentApplications: [...formalFacts.paymentApplications, ...demoFacts.paymentApplications],
            paymentRecords: [...formalFacts.paymentRecords, ...demoFacts.paymentRecords],
            settlements: [...combinedFacts.settlements, ...demoFacts.settlements],
            penalties: [...formalFacts.penalties, ...demoFacts.penalties],
            files: [...formalFacts.files, ...demoFacts.files],
          },
      capabilities,
      sourceVersion: `${commandInstance.sourceVersion()}+${ownerDocumentSource.sourceVersion(sessionId)}`,
    }
  }

  return {
    reset(scenario: SubcontractContractReadTestScenario, sessionId?: string | null) {
      if (scenario === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), scenario)
    },
    list(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const parsed = parseSubcontractContractListQuery(input)
      return buildSubcontractContractListPage({ ...data, query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') }, asOf: FIXED_AS_OF })
    },
    detail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const parsed = parseSubcontractContractDetailQuery(id, input)
      return buildSubcontractContractDetail({ ...data, query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') }, asOf: FIXED_AS_OF })
    },
  }
}

export const subcontractContractReadTestInstance = createSubcontractContractReadTestInstance()
