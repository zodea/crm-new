import type {
  ConstructionContractDetailSource,
  ConstructionContractFactSource,
  ConstructionContractFactSources,
} from '../../app/lib/construction-contract/repository'
import {
  buildConstructionContractDetail,
  buildConstructionContractListPage,
  constructionContractProblem,
  ConstructionContractRepositoryProblem,
  parseConstructionContractDetailQuery,
  parseConstructionContractListQuery,
} from '../../app/lib/construction-contract/repository'
import contractsSeed from '../../app/lib/db/seed/contracts.json'
import customersSeed from '../../app/lib/db/seed/customers.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import { constructionContractCommandTestInstance } from './construction-contract-command-test-instance'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'

export type ConstructionContractReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-24T00:00:00.000Z'
const projects = new Map(projectsSeed.map(row => [row.id, row]))
const customers = new Map(customersSeed.map(row => [row.id, row.name]))

const demoContracts: ConstructionContractDetailSource[] = contractsSeed
  .filter(row => row.kind === '施工')
  .map((row) => {
    const project = projects.get(row.project_id ?? '')
    const customerId = project?.customer_id ?? null
    return {
      dataOrigin: 'demo',
      id: row.id,
      no: row.no,
      name: row.name,
      kind: row.kind,
      projectId: row.project_id,
      projectName: project?.name ?? '',
      projectPermission: 'allowed',
      customerId,
      customerName: customers.get(customerId ?? '') ?? '',
      customerPermission: 'allowed',
      amount: Number(row.amount ?? 0),
      settledAmount: Number(row.settled ?? 0),
      invoicedAmount: Number(row.invoiced ?? 0),
      receivedAmount: Number(row.paid ?? 0),
      actualCompletionDate: null,
      content: row.name.replace(/合同$/, ''),
      invoiceType: '增值税专用发票',
      contactName: '项目商务负责人',
      contactPhone: '13800000320',
      taxRate: 9,
      signDate: row.sign_date || null,
      mainTerms: '按月报量并以甲方审定结果结算。',
      paymentTerms: '按审定进度与开票情况收款。',
      warrantyTerms: '按合同约定承担竣工验收及保修责任。',
      retentionRatio: 0.03,
      retentionAmount: Number(row.amount ?? 0) * 0.03,
      retentionDays: 730,
      invoiceName: customers.get(customerId ?? '') ?? '',
      invoiceTaxNo: '91440100DEMO0320',
      invoiceAddressPhone: '广州市示例路 320 号 020-8888320',
      invoiceBank: '示例银行广州分行',
      invoiceBankAccount: '6222026000000320',
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })

function fact(
  id: string,
  no: string,
  name: string,
  amount: number | null,
  date: string,
  status: string,
  extra: Partial<ConstructionContractFactSource> = {},
): ConstructionContractFactSource {
  return {
    dataOrigin: 'demo',
    id,
    contractId: 'con_demo_sg01',
    no,
    name,
    amount,
    date,
    status,
    ...extra,
  }
}

const demoFacts: ConstructionContractFactSources = {
  supplements: [fact('cs_demo_sg01_01', 'RJ-HHXC-SG-2025001-BC01', '材料调价补充协议', 320000, '2026-03-10', '有效')],
  changes: [fact('boq_ledger_demo_001', 'BG-2026-001', '已审定甲方变洽签', 520, '2026-04-02', 'approved', { sourceId: 'boq_change_demo_001' })],
  monthlyStatements: [fact('monthly_statement_demo_001', '2026-06', '2026 年 6 月月度报量', 4960, '2026-07-01', 'draft')],
  finalSettlements: [],
  penalties: [],
  invoiceApplications: [fact('ia_mz0x1_0', 'KP-2026-001', '2026年6月进度开票申请', 25663629, '2026-06-10', '已审核')],
  invoiceRegistrations: [],
  receipts: [fact('rr_mz0x1_0', 'SK-2026-001', '合和地产集团进度收款', 25367027, '2026-05-30', 'submitted', { customerId: 'customer_demo_001' })],
  acceptances: [],
  warranties: [],
  files: [],
}

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new ConstructionContractRepositoryProblem({
    ...constructionContractProblem(code, message, retryable),
    traceId: `construction-contract-test-${code}`,
  })
}

type OwnerDocumentReadSource = Pick<typeof ownerCommercialDocumentCommandTestInstance, 'rows' | 'sourceVersion'>

export function createConstructionContractReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  commandInstance = constructionContractCommandTestInstance,
  ownerDocumentCommandInstance: OwnerDocumentReadSource = ownerCommercialDocumentCommandTestInstance,
) {
  const scenarios = new Map<string, ConstructionContractReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无施工合同查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '施工合同中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes('construction-contract:read'))
      throw problem('forbidden', '无施工合同查看权限')
    const formalRows = commandInstance.rows(sessionId)
    const formalFacts = commandInstance.facts(sessionId)
    const ownerDocuments = ownerDocumentCommandInstance.rows(sessionId)
    const ownerChanges = ownerDocuments
      .filter(row => row.kind === 'owner_change')
      .map(row => ({
        dataOrigin: row.dataOrigin,
        id: row.id,
        contractId: row.contractId,
        no: row.no,
        name: row.name,
        amount: row.amount,
        date: row.applicationDate,
        status: row.status,
        sourceId: row.sourceId,
      }))
    const ownerReports = ownerDocuments
      .filter(row => row.kind === 'owner_report')
      .map(row => ({
        dataOrigin: row.dataOrigin,
        id: row.id,
        contractId: row.contractId,
        no: row.no,
        name: row.name,
        amount: row.amount,
        date: row.applicationDate,
        status: row.status,
      }))
    const ownerAcceptances = ownerDocuments
      .filter(row => row.kind === 'acceptance')
      .map(row => ({
        dataOrigin: row.dataOrigin,
        id: row.id,
        contractId: row.contractId,
        no: row.no,
        name: row.name,
        amount: row.amount,
        date: row.acceptanceLifecycle?.acceptanceDate ?? row.applicationDate,
        status: row.status,
      }))
    const ownerWarranties = ownerDocuments
      .filter(row => row.kind === 'acceptance' && (row.status === 'warranty' || row.status === 'expired'))
      .map(row => ({
        dataOrigin: row.dataOrigin,
        id: row.id,
        contractId: row.contractId,
        no: row.no,
        name: row.name,
        amount: row.amount,
        date: row.acceptanceLifecycle?.warrantyEndDate ?? null,
        status: row.status,
      }))
    const synchronizedFacts = {
      ...formalFacts,
      changes: [...formalFacts.changes, ...ownerChanges],
      monthlyStatements: [...formalFacts.monthlyStatements, ...ownerReports],
      acceptances: [...formalFacts.acceptances, ...ownerAcceptances],
      warranties: [...formalFacts.warranties, ...ownerWarranties],
    }
    return {
      contracts: scenario === 'empty' ? formalRows : [...formalRows, ...demoContracts],
      facts: scenario === 'empty'
        ? synchronizedFacts
        : {
            supplements: [...formalFacts.supplements, ...demoFacts.supplements],
            changes: [...synchronizedFacts.changes, ...demoFacts.changes],
            monthlyStatements: [...synchronizedFacts.monthlyStatements, ...demoFacts.monthlyStatements],
            finalSettlements: [...formalFacts.finalSettlements, ...demoFacts.finalSettlements],
            penalties: [...formalFacts.penalties, ...demoFacts.penalties],
            invoiceApplications: [...formalFacts.invoiceApplications, ...demoFacts.invoiceApplications],
            invoiceRegistrations: [...formalFacts.invoiceRegistrations, ...demoFacts.invoiceRegistrations],
            receipts: [...formalFacts.receipts, ...demoFacts.receipts],
            acceptances: [...synchronizedFacts.acceptances, ...demoFacts.acceptances],
            warranties: [...synchronizedFacts.warranties, ...demoFacts.warranties],
            files: [...formalFacts.files, ...demoFacts.files],
          },
      capabilities,
      sourceVersion: `${commandInstance.sourceVersion(sessionId)}+${ownerDocumentCommandInstance.sourceVersion(sessionId)}`,
    }
  }

  return {
    reset(scenario: ConstructionContractReadTestScenario, sessionId?: string | null) {
      if (scenario === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), scenario)
    },
    list(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const parsed = parseConstructionContractListQuery(input)
      return buildConstructionContractListPage({
        ...data,
        query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') },
        asOf: FIXED_AS_OF,
      })
    },
    detail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const parsed = parseConstructionContractDetailQuery(id, input)
      return buildConstructionContractDetail({
        ...data,
        query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') },
        asOf: FIXED_AS_OF,
      })
    },
  }
}

export const constructionContractReadTestInstance = createConstructionContractReadTestInstance()
