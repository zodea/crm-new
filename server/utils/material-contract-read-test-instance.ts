import type {
  MaterialContractDetailSource,
  MaterialContractDocumentSource,
  MaterialContractFactSources,
  MaterialContractLineSource,
} from '../../app/lib/material-contract/repository'
import contractsSeed from '../../app/lib/db/seed/contracts.json'
import projectsSeed from '../../app/lib/db/seed/projects.json'
import suppliersSeed from '../../app/lib/db/seed/suppliers.json'
import { buildContractPriceFacts } from '../../app/lib/material-contract/price-facts'
import {
  buildMaterialContractDetail,
  buildMaterialContractListPage,
  materialContractProblem,
  MaterialContractRepositoryProblem,
  parseMaterialContractDetailQuery,
  parseMaterialContractListQuery,
} from '../../app/lib/material-contract/repository'
import { resolveBusinessSession } from './business-session'
import { commandFingerprint } from './command-journal'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { materialContractCommandTestInstance } from './material-contract-command-test-instance'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from './read-meta'

export type MaterialContractReadTestScenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

const FIXED_AS_OF = '2026-08-24T00:00:00.000Z'
const projectNames = new Map(projectsSeed.map(row => [row.id, row.name]))
const supplierNames = new Map(suppliersSeed.map(row => [row.id, row.name]))

const demoContracts: MaterialContractDetailSource[] = contractsSeed
  .filter(row => row.kind === '材采')
  .map(row => ({
    dataOrigin: 'demo',
    id: row.id,
    no: row.no,
    name: row.name,
    kind: row.kind,
    projectId: row.project_id,
    projectName: projectNames.get(row.project_id ?? '') ?? '',
    projectReferenceState: 'resolved',
    supplierId: row.supplier_id,
    supplierName: supplierNames.get(row.supplier_id ?? '') ?? '',
    supplierReferenceState: 'resolved',
    amount: Number(row.amount ?? 0),
    supplementAmount: Number(row.changed ?? row.amount ?? 0) - Number(row.amount ?? 0),
    settledAmount: Number(row.settled ?? 0),
    invoicedAmount: Number(row.invoiced ?? 0),
    paidAmount: Number(row.paid ?? 0),
    content: row.name.replace(/合同$/, ''),
    invoiceType: '增值税专用发票',
    contactName: '材料负责人',
    contactPhone: '13800000318',
    taxRate: 13,
    signDate: row.sign_date || null,
    mainTerms: '按采购清单与验收结果履行。',
    paymentTerms: '按月结算，审核后支付。',
    brandQualityTerms: '品牌、规格及质量须符合采购清单。',
    scheduleTerms: '按项目进度通知分批供货。',
    warrantyTerms: '质量保证期十二个月。',
    specialTerms: '',
    retentionRatio: 0.03,
    retentionAmount: Number(row.amount ?? 0) * 0.03,
    retentionDays: 365,
    invoiceName: '瑞航建设有限公司',
    invoiceTaxNo: '91310000DEMO0318',
    invoiceAddressPhone: '上海市示例路 318 号 021-8888318',
    invoiceBank: '示例银行上海分行',
    invoiceBankAccount: '6222026000000318',
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

const demoLines: MaterialContractLineSource[] = [
  { dataOrigin: 'demo', id: 'line-demo-318-1', contractId: 'con_demo_cg01', materialName: '墙地砖', spec: '600×600mm', brand: '示例品牌', unit: '㎡', qty: 1000, taxInclusiveUnitPrice: 120, plannedArrivalDate: '2026-02-01', note: '', sortOrder: 0 },
  { dataOrigin: 'demo', id: 'line-demo-318-2', contractId: 'con_demo_cg01', materialName: '粘结剂', spec: '20kg/袋', brand: '示例品牌', unit: '袋', qty: 500, taxInclusiveUnitPrice: 42, plannedArrivalDate: '2026-02-01', note: '', sortOrder: 1 },
]

function document(
  id: string,
  no: string,
  name: string,
  amount: number | null,
  date: string,
  status: string,
): MaterialContractDocumentSource {
  return { dataOrigin: 'demo', id, contractId: 'con_demo_cg01', no, name, amount, date, status }
}

const demoFacts: MaterialContractFactSources = {
  lineItems: demoLines,
  materialRequisitions: [document('mat-req-demo-318', 'XL-2026-0318', '瓷砖首批下料单', 120000, '2026-01-20', '已下料')],
  materialArrivals: [document('mat-arr-demo-318', 'DH-2026-0318', '瓷砖首批到货单', 118000, '2026-02-02', '已验收')],
  invoices: [document('invoice-demo-318', 'FP-2026-0318', '瓷砖首期收票', 118000, '2026-02-10', '已入账')],
  paymentApplications: [document('pay-app-demo-318', 'QK-2026-0318', '瓷砖首期请款', 100000, '2026-02-15', '已审批')],
  paymentRecords: [{ dataOrigin: 'demo', id: 'pay-record-demo-318', no: 'ZF-2026-0318', amount: 80000, confirmationStatus: 'confirmed', paymentDate: '2026-02-20' }],
  paymentAllocations: [{ dataOrigin: 'demo', paymentRecordId: 'pay-record-demo-318', paymentApplicationId: 'pay-app-demo-318', allocatedAmount: 80000 }],
  settlements: [document('settlement-demo-318', 'JS-2026-0318', '瓷砖阶段结算', 118000, '2026-03-01', '已确认')],
  penalties: [document('penalty-demo-318', 'FK-2026-0318', '包装破损扣罚', 2000, '2026-02-05', '已确认')],
  files: [{ dataOrigin: 'demo', id: 'file-demo-318', contractId: 'con_demo_cg01', fileName: '瓷砖采购合同扫描件.pdf', fileSize: 2048, mimeType: 'application/pdf', category: '合同', uploadedAt: '2026-01-16T00:00:00.000Z' }],
}
const demoVersion = `material-demo-${commandFingerprint({ contracts: demoContracts, facts: demoFacts })}`

function problem(code: 'forbidden' | 'unavailable', message: string, retryable = false) {
  return new MaterialContractRepositoryProblem({
    ...materialContractProblem(code, message, retryable),
    traceId: `material-contract-test-${code}`,
  })
}

export function createMaterialContractReadTestInstance(
  resolveCapabilities: (sessionId?: string | null) => readonly string[] = id => demoWorkspaceTestInstance.capabilities(id),
  resolveSession = resolveBusinessSession,
) {
  const scenarios = new Map<string, MaterialContractReadTestScenario>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function context(sessionId?: string | null) {
    const scenario = scenarios.get(keyFor(sessionId)) ?? 'ready'
    if (scenario === 'forbidden')
      throw problem('forbidden', '无材料采购合同查看权限')
    if (scenario === 'unavailable')
      throw problem('unavailable', '材料采购合同中央读取服务暂时不可用', true)
    const capabilities = [...resolveCapabilities(sessionId)]
    if (!capabilities.includes('material-contract:read'))
      throw problem('forbidden', '无材料采购合同查看权限')
    const formalRows = materialContractCommandTestInstance.rows(sessionId)
    const formalFacts = materialContractCommandTestInstance.facts(sessionId)
    return {
      contracts: (scenario === 'empty' ? formalRows : [...formalRows, ...demoContracts]).map(row => ({ ...row, projectReferenceState: capabilities.includes('project:list:read') ? row.projectReferenceState : 'forbidden' as const, supplierReferenceState: capabilities.includes('supplier:list:read') ? row.supplierReferenceState : 'forbidden' as const })),
      facts: scenario === 'empty'
        ? formalFacts
        : {
            deductions: [...(formalFacts.deductions ?? [])],
            supplements: [...(formalFacts.supplements ?? [])],
            lineItems: [...formalFacts.lineItems, ...demoFacts.lineItems],
            materialRequisitions: [...formalFacts.materialRequisitions, ...demoFacts.materialRequisitions],
            materialArrivals: [...formalFacts.materialArrivals, ...demoFacts.materialArrivals],
            invoices: [...formalFacts.invoices, ...demoFacts.invoices],
            paymentApplications: [...formalFacts.paymentApplications, ...demoFacts.paymentApplications],
            paymentRecords: [...formalFacts.paymentRecords, ...demoFacts.paymentRecords],
            paymentAllocations: [...formalFacts.paymentAllocations, ...demoFacts.paymentAllocations],
            settlements: [...formalFacts.settlements, ...demoFacts.settlements],
            penalties: [...formalFacts.penalties, ...demoFacts.penalties],
            files: [...formalFacts.files, ...demoFacts.files],
          },
      capabilities,
      session: { ...resolveSession(), capabilities },
      sourceVersion: materialContractCommandTestInstance.sourceVersion(sessionId),
    }
  }

  function metadata(data: ReturnType<typeof context>, origin: 'real' | 'demo', requested: boolean, operation: string, scope: unknown) {
    const readable = requested && (origin === 'real' || data.capabilities.includes('demo:read'))
    const state = requested ? readable ? 'readable' as const : 'forbidden' as const : 'not-requested' as const
    return createReadMeta({ session: data.session, schemaVersion: operation === 'material-contract:prices' ? 'material-contract-prices-v1' : 'material-contract-read-v2', operation, dataOrigin: origin, asOf: FIXED_AS_OF, coverage: readable ? 'complete' : 'unknown', scope, sources: [...(origin === 'demo'
      ? [{ key: 'material-demo', state, sourceVersion: readable ? demoVersion : null, asOf: readable ? FIXED_AS_OF : null }]
      : [
          { key: 'material-contracts', state, sourceVersion: readable ? data.sourceVersion : null, asOf: readable ? FIXED_AS_OF : null },
          { key: 'material-finance', state: 'unavailable' as const, sourceVersion: null, asOf: null },
        ]), ...(['project', 'supplier'] as const).map((entity) => {
      const canRead = readable && data.capabilities.includes(`${entity}:list:read`)
      return { key: `material-${entity}-references`, state: !requested ? 'not-requested' as const : canRead ? 'readable' as const : 'forbidden' as const, sourceVersion: canRead ? origin === 'demo' ? demoVersion : data.sourceVersion : null, asOf: canRead ? FIXED_AS_OF : null }
    })] })
  }

  return {
    prices(origin: 'real' | 'demo', sessionId?: string | null) {
      const data = context(sessionId)
      if (origin === 'demo' && !data.capabilities.includes('demo:read'))
        throw problem('forbidden', '无测试合同约定价查看权限')
      const meta = metadata(data, origin, true, 'material-contract:prices', { origin })
      const items = buildContractPriceFacts(data.contracts.filter(row => row.dataOrigin === origin), data.facts)
      return withReadMeta({ ...meta, dataOrigin: origin, items }, meta)
    },
    reset(scenario: MaterialContractReadTestScenario, sessionId?: string | null) {
      if (scenario === 'ready')
        scenarios.delete(keyFor(sessionId))
      else
        scenarios.set(keyFor(sessionId), scenario)
    },
    list(input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const parsed = parseMaterialContractListQuery(input)
      const originMeta = {
        real: metadata(data, 'real', parsed.origin !== 'demo', 'material-contract:list', readQueryScope(parsed as unknown as Record<string, unknown>)),
        demo: metadata(data, 'demo', parsed.includeDemo && parsed.origin !== 'real', 'material-contract:list', readQueryScope(parsed as unknown as Record<string, unknown>)),
      }
      const meta = originMeta[parsed.origin ?? 'real']
      return withOriginReadMeta(buildMaterialContractListPage({
        ...data,
        query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') },
        ...meta,
      }), originMeta, parsed.origin ?? 'real')
    },
    detail(id: string, input: Record<string, unknown> | undefined, sessionId?: string | null) {
      const data = context(sessionId)
      const parsed = parseMaterialContractDetailQuery(id, input)
      const meta = metadata(data, parsed.origin, true, 'material-contract:detail', parsed)
      return withReadMeta(buildMaterialContractDetail({
        ...data,
        query: { ...parsed, includeDemo: parsed.includeDemo && data.capabilities.includes('demo:read') },
        ...meta,
      }), meta)
    },
  }
}

export const materialContractReadTestInstance = createMaterialContractReadTestInstance()
