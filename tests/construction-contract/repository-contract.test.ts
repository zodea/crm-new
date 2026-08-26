import type {
  ConstructionContractDetailSource,
  ConstructionContractFactSources,
} from '~/lib/construction-contract/repository'
import { describe, expect, it } from 'vitest'
import {
  buildConstructionContractDetail,
  buildConstructionContractListPage,
  parseConstructionContractDetailQuery,
  parseConstructionContractListQuery,
} from '~/lib/construction-contract/repository'

const AS_OF = '2026-08-24T00:00:00.000Z'

function source(
  overrides: Partial<ConstructionContractDetailSource> = {},
): ConstructionContractDetailSource {
  return {
    dataOrigin: 'real',
    id: 'construction-contract-1',
    no: 'SG-001',
    name: '中央施工合同',
    kind: '施工',
    projectId: 'project-1',
    projectName: '中央项目',
    projectPermission: 'allowed',
    customerId: 'customer-1',
    customerName: '中央客户',
    customerPermission: 'allowed',
    amount: 1000,
    settledAmount: 600,
    invoicedAmount: 500,
    receivedAmount: 450,
    actualCompletionDate: null,
    content: '住宅装修施工',
    invoiceType: '增值税专用发票',
    contactName: '陈经理',
    contactPhone: '13800001234',
    taxRate: 9,
    signDate: '2026-08-01',
    mainTerms: '按月报量',
    paymentTerms: '审定后付款',
    warrantyTerms: '质保两年',
    retentionRatio: 0.03,
    retentionAmount: 30,
    retentionDays: 730,
    invoiceName: '中央客户',
    invoiceTaxNo: '91440101TEST000001',
    invoiceAddressPhone: '',
    invoiceBank: '',
    invoiceBankAccount: '',
    status: '履约中',
    note: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: AS_OF,
    ...overrides,
  }
}

function emptyFacts(): ConstructionContractFactSources {
  return {
    supplements: [],
    changes: [],
    monthlyStatements: [],
    finalSettlements: [],
    penalties: [],
    invoiceApplications: [],
    invoiceRegistrations: [],
    receipts: [],
    acceptances: [],
    warranties: [],
    files: [],
  }
}

describe('施工合同中央 Repository contract', () => {
  it('列表保留施工专属列，实际竣工无 canonical 事实时保持 null', () => {
    const page = buildConstructionContractListPage({
      contracts: [
        source(),
        source({ dataOrigin: 'demo', id: 'demo-contract', amount: 9999 }),
      ],
      facts: {
        ...emptyFacts(),
        supplements: [{
          dataOrigin: 'real',
          id: 'supplement-1',
          contractId: 'construction-contract-1',
          no: 'BC-001',
          name: '调价补充协议',
          amount: 100,
          date: '2026-08-10',
          status: '有效',
        }],
        changes: [{
          dataOrigin: 'real',
          id: 'change-1',
          contractId: 'construction-contract-1',
          no: 'BG-001',
          name: '已审定变更',
          amount: 50,
          date: '2026-08-11',
          status: 'approved',
          sourceId: 'owner-change-1',
        }],
      },
      query: parseConstructionContractListQuery({ page: '1', pageSize: '10' }),
      asOf: AS_OF,
      sourceVersion: 'construction-contract-v1',
      capabilities: ['construction-contract:read'],
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      rowKey: 'real:construction-contract-1',
      actualCompletionDate: null,
      signDate: '2026-08-01',
      amounts: {
        contract: '1000.00',
        changed: '1150.00',
        settled: '600.00',
        invoiced: '500.00',
        received: '450.00',
        bySettlementReceivable: '150.00',
        invoicedUnreceived: '50.00',
      },
    })
    expect(page.summary.origins.real.changedAmount).toBe('1150.00')
    expect(page.summary.origins.demo.contractCount).toBe(0)
  })

  it('详情按稳定合同 ID 拆成七个施工分区并保留真实空态', () => {
    const facts: ConstructionContractFactSources = {
      ...emptyFacts(),
      supplements: [{
        dataOrigin: 'real',
        id: 'supplement-1',
        contractId: 'construction-contract-1',
        no: 'BC-001',
        name: '调价补充协议',
        amount: 100,
        date: '2026-08-10',
        status: '有效',
      }],
      changes: [{
        dataOrigin: 'real',
        id: 'change-1',
        contractId: 'construction-contract-1',
        no: 'BG-001',
        name: '已审定变更',
        amount: 50,
        date: '2026-08-11',
        status: 'approved',
        sourceId: 'owner-change-1',
      }],
      monthlyStatements: [{
        dataOrigin: 'real',
        id: 'statement-1',
        contractId: 'construction-contract-1',
        no: '2026-08',
        name: '八月报量',
        amount: 600,
        date: '2026-08-20',
        status: 'submitted',
      }],
      invoiceApplications: [{
        dataOrigin: 'real',
        id: 'invoice-app-1',
        contractId: 'construction-contract-1',
        no: 'KP-001',
        name: '进度开票申请',
        amount: 500,
        date: '2026-08-21',
        status: 'approved',
      }],
      receipts: [{
        dataOrigin: 'real',
        id: 'receipt-1',
        contractId: 'construction-contract-1',
        customerId: 'customer-1',
        no: 'SK-001',
        name: '进度收款',
        amount: 450,
        date: '2026-08-22',
        status: 'submitted',
      }],
      acceptances: [{
        dataOrigin: 'real',
        id: 'acceptance-324',
        contractId: 'construction-contract-1',
        no: 'YS-324',
        name: '项目竣工验收',
        amount: 1000,
        date: '2026-07-18',
        status: 'warranty',
      }],
      warranties: [{
        dataOrigin: 'real',
        id: 'acceptance-324',
        contractId: 'construction-contract-1',
        no: 'YS-324',
        name: '项目竣工验收',
        amount: 1000,
        date: '2028-07-18',
        status: 'warranty',
      }],
    }
    const detail = buildConstructionContractDetail({
      contracts: [source()],
      facts,
      query: parseConstructionContractDetailQuery('construction-contract-1', { origin: 'real' }),
      asOf: AS_OF,
      sourceVersion: 'construction-contract-v2',
      capabilities: ['construction-contract:read', 'construction-contract:write'],
    })

    expect(detail.contract.actualCompletionDate).toBeNull()
    expect(detail.sections.supplements[0]?.navigation).toMatchObject({
      kind: 'entity-subview',
      subject: { entity: 'contract', id: 'construction-contract-1' },
      variant: 'supplement',
      view: 'supplement-1',
    })
    expect(detail.sections.changes[0]?.navigation).toMatchObject({
      kind: 'entity-detail',
      subject: { entity: 'owner-document', id: 'change-1' },
      variant: 'change',
      filters: { dataOrigin: 'real' },
    })
    expect(detail.sections.settlements).toEqual({
      monthlyStatements: [expect.objectContaining({ id: 'statement-1' })],
      finalSettlements: [],
      penalties: [],
    })
    expect(detail.sections.settlements.monthlyStatements[0]?.navigation).toMatchObject({
      kind: 'entity-detail',
      subject: { entity: 'owner-document', id: 'statement-1' },
      variant: 'report',
    })
    expect(detail.sections.invoices).toEqual({
      applications: [expect.objectContaining({ id: 'invoice-app-1' })],
      registrations: [],
    })
    expect(detail.sections.receipts[0]?.navigation).toMatchObject({
      kind: 'entity-detail',
      subject: { entity: 'receipt', id: 'receipt-1' },
      filters: { customerId: 'customer-1', dataOrigin: 'real' },
    })
    expect(detail.sections.acceptance.acceptances[0]?.navigation).toMatchObject({
      kind: 'entity-detail',
      subject: { entity: 'owner-document', id: 'acceptance-324' },
      variant: 'acceptance',
      filters: { dataOrigin: 'real' },
    })
    expect(detail.sections.acceptance.warranties[0]?.navigation).toMatchObject({
      kind: 'entity-detail',
      subject: { entity: 'owner-document', id: 'acceptance-324' },
      variant: 'warranty',
      filters: { dataOrigin: 'real' },
    })
    expect(detail.capabilities).toContain('construction-contract:write')
  })

  it('正式与演示同 ID 时按来源精确解析，不允许来源串线', () => {
    expect(() => buildConstructionContractDetail({
      contracts: [source({ dataOrigin: 'demo' })],
      facts: emptyFacts(),
      query: parseConstructionContractDetailQuery('construction-contract-1', { origin: 'real', includeDemo: 'true' }),
      asOf: AS_OF,
      sourceVersion: null,
      capabilities: ['construction-contract:read', 'demo:read'],
    })).toThrowError(/来源/)
  })

  it('直接深链按稳定补充协议 ID 区分父合同错配与目标不存在', () => {
    const contracts = [
      source(),
      source({ id: 'construction-contract-2', no: 'SG-002', name: '其他施工合同' }),
    ]
    const facts: ConstructionContractFactSources = {
      ...emptyFacts(),
      supplements: [{
        dataOrigin: 'real',
        id: 'supplement-other-contract',
        contractId: 'construction-contract-2',
        no: 'BC-002',
        name: '其他合同补充协议',
        amount: 80,
        date: '2026-08-12',
        status: '有效',
      }],
    }
    const build = (focusId: string) => buildConstructionContractDetail({
      contracts,
      facts,
      query: parseConstructionContractDetailQuery('construction-contract-1', { origin: 'real', focusId }),
      asOf: AS_OF,
      sourceVersion: 'construction-contract-v3',
      capabilities: ['construction-contract:read'],
    })
    expect(() => build('supplement-other-contract')).toThrowError(/补充协议与施工合同不匹配/)
    expect(() => build('missing-supplement')).toThrowError(/补充协议不存在/)
  })

  it('拒绝不能形成 canonical focus 的补充协议 ID', () => {
    expect(() => parseConstructionContractDetailQuery('construction-contract-1', {
      origin: 'real',
      focusId: '\0',
    })).toThrowError(/查询参数无效/)
  })

  it('允许按稳定业务单据 ID 聚焦合同内的变洽签与月度报量', () => {
    const facts: ConstructionContractFactSources = {
      ...emptyFacts(),
      changes: [{
        dataOrigin: 'real',
        id: 'change-323',
        contractId: 'construction-contract-1',
        no: 'BG-323',
        name: '甲方变洽签',
        amount: 323,
        date: '2026-08-25',
        status: '已上报',
      }],
      monthlyStatements: [{
        dataOrigin: 'real',
        id: 'report-323',
        contractId: 'construction-contract-1',
        no: 'BL-323',
        name: '月度报量',
        amount: 292,
        date: '2026-08-25',
        status: '已申报',
      }],
    }
    const build = (focusId: string) => buildConstructionContractDetail({
      contracts: [source()],
      facts,
      query: parseConstructionContractDetailQuery('construction-contract-1', { origin: 'real', focusId }),
      asOf: AS_OF,
      sourceVersion: 'construction-contract-v3',
      capabilities: ['construction-contract:read'],
    })

    expect(build('change-323').sections.changes[0]?.id).toBe('change-323')
    expect(build('report-323').sections.settlements.monthlyStatements[0]?.id).toBe('report-323')
  })
})
