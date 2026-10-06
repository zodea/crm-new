import type {
  SubcontractContractDetailSource,
  SubcontractContractFactSources,
} from '../../app/lib/subcontract-contract/repository'
import { describe, expect, it } from 'vitest'
import {
  buildSubcontractContractDetail,
  buildSubcontractContractListPage,
  decodeSubcontractContractDetailRead,
  decodeSubcontractContractListPage,
  parseSubcontractContractDetailQuery,
  parseSubcontractContractListQuery,
} from '../../app/lib/subcontract-contract/repository'
import { withOriginReadMeta, withReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

const contract: SubcontractContractDetailSource = {
  dataOrigin: 'real',
  id: 'subcontract-321',
  no: 'FB-2026-0321',
  name: '样板劳务分包合同',
  kind: '分包',
  subKind: '劳务',
  projectId: 'project-321',
  projectName: '样板项目',
  projectPermission: 'allowed',
  supplierId: 'supplier-321',
  supplierName: '样板劳务分供方',
  supplierPermission: 'allowed',
  amount: 1000,
  settlementStatus: null,
  clearanceStatus: null,
  content: '劳务分包',
  invoiceType: '增值税专用发票',
  contactName: '联系人',
  contactPhone: '13800138000',
  taxRate: 0.03,
  signDate: '2026-08-01',
  mainTerms: '按月计量',
  paymentTerms: '结算后付款',
  warrantyTerms: '',
  retentionRatio: null,
  retentionAmount: null,
  retentionDays: null,
  status: '履约中',
  note: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
}

const facts: SubcontractContractFactSources = {
  supplements: [
    { dataOrigin: 'real', id: 'supplement-1', contractId: contract.id, no: 'BC-1', name: '补充协议', amount: 100, date: '2026-08-02', status: '生效' },
  ],
  changes: [
    { dataOrigin: 'real', id: 'sub-change-327', contractId: contract.id, no: 'FB-BG-327', name: '样板层劳务范围调整', amount: 38000, date: '2026-08-27', status: '已提交' },
  ],
  invoices: [
    { dataOrigin: 'real', id: 'invoice-1', contractId: contract.id, no: 'FP-1', name: '劳务发票', amount: 600, date: '2026-08-10', status: '已归档' },
  ],
  paymentApplications: [
    { dataOrigin: 'real', id: 'application-1', contractId: contract.id, no: 'FK-1', name: '进度付款申请', amount: 450, date: '2026-08-16', status: '审批中' },
  ],
  paymentRecords: [
    { dataOrigin: 'real', id: 'payment-1', contractId: contract.id, no: 'ZF-1', name: '银行支付', amount: 400, date: '2026-08-18', status: '已确认' },
  ],
  settlements: [
    { dataOrigin: 'real', id: 'settlement-progress', contractId: contract.id, no: 'JS-1', name: '过程结算', amount: 700, date: '2026-08-12', status: '已确认', settlementKind: 'progress' },
    { dataOrigin: 'real', id: 'settlement-completion', contractId: contract.id, no: 'JS-2', name: '完工结算', amount: 200, date: '2026-08-20', status: '已确认', settlementKind: 'completion' },
  ],
  penalties: [],
  files: [],
}

describe('分包合同中央 Repository 契约', () => {
  it('受限关联清空身份；列表和详情拒绝隐藏定位及失配导航，独立金额仍可读', () => {
    const restricted = { ...contract, projectPermission: 'forbidden' as const, supplierPermission: 'forbidden' as const }
    const input = { contracts: [restricted], facts, asOf: '2026-08-25T00:00:00.000Z', sourceVersion: 'privacy-v1', capabilities: ['subcontract-contract:read'] }
    const evidence = { ...input, schemaVersion: 'subcontract-contract-read-v2', scope: { fixture: 'restricted-owner' }, requested: true }
    const page = withOriginReadMeta(buildSubcontractContractListPage({ ...input, query: parseSubcontractContractListQuery({}) }), { real: publicReadMeta({ ...evidence, dataOrigin: 'real' }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo', requested: false }) })
    const detail = withReadMeta(buildSubcontractContractDetail({ ...input, query: parseSubcontractContractDetailQuery(restricted.id, { origin: 'real' }) }), publicReadMeta({ ...evidence, dataOrigin: 'real' }))
    const reference = { state: 'forbidden', entity: 'supplier', id: null, label: null, reason: 'permission-denied' }
    expect(page.summary.projects).toEqual([])
    expect(page.summary.suppliers).toEqual([])
    expect(page.items[0]!.supplier).toEqual(reference)
    expect(detail.contract.supplier).toEqual(reference)
    expect(detail.contract.project.id).toBeNull()
    expect(detail.contract.amounts.contract).toBe('1000.00')
    expect(decodeSubcontractContractListPage(page).items[0]!.supplier.id).toBeNull()
    expect(decodeSubcontractContractDetailRead(detail).contract.supplier.id).toBeNull()
    for (const changed of [{ ...reference, id: 'restricted-identity' }, { ...reference, originalId: 'restricted-identity' }, { ...reference, label: '敏感旧名称' }]) {
      expect(() => decodeSubcontractContractListPage({ ...page, items: [{ ...page.items[0], supplier: changed }] })).toThrow('无效')
      expect(() => decodeSubcontractContractDetailRead({ ...detail, contract: { ...detail.contract, supplier: changed } })).toThrow('无效')
    }
    expect(() => decodeSubcontractContractDetailRead({ ...detail, supplierNavigation: { kind: 'unavailable', reason: 'forbidden', filters: { supplierId: 'restricted-identity' } } })).toThrow('无效')
  })

  it('状态和类别各自 OR、字段之间 AND，分页和汇总共用筛选结果', () => {
    const contracts = [
      ...Array.from({ length: 12 }, (_, index) => ({ ...contract, id: `match-${index}`, status: index % 2 ? '草稿' : '履约中', subKind: index % 2 ? '劳务' : '专业' })),
      { ...contract, id: 'excluded-status', status: '已结清' },
      { ...contract, id: 'excluded-kind', subKind: '其他' },
    ]
    const input = { contracts, facts, asOf: '2026-08-25T00:00:00.000Z', sourceVersion: 'multi-filter', capabilities: [] }
    const page = buildSubcontractContractListPage({
      ...input,
      query: parseSubcontractContractListQuery({ status: '["草稿","履约中"]', subKind: '["劳务","专业"]' }),
    })
    expect(page.items).toHaveLength(10)
    expect(page.pagination.total).toBe(12)
    expect(page.summary.origins.real).toMatchObject({ contractCount: 12, changedAmount: '12000.00' })
    const labor = buildSubcontractContractListPage({
      ...input,
      query: parseSubcontractContractListQuery({ status: '["草稿","履约中"]', subKind: '["劳务"]' }),
    })
    expect(labor.pagination.total).toBe(6)
    expect(labor.items.every(row => row.subKind === '劳务')).toBe(true)
  })

  it('只从真实合同外键事实派生分包专属金额，且不从余额猜结清状态', () => {
    const page = buildSubcontractContractListPage({
      contracts: [contract],
      facts,
      query: parseSubcontractContractListQuery({}),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'subcontract-contract-v1',
      capabilities: ['subcontract-contract:read'],
    })

    expect(page.items[0]?.amounts).toEqual({
      contract: '1000.00',
      changed: '1100.00',
      settled: '900.00',
      invoiced: '600.00',
      paid: '400.00',
      bySettlementPayable: '500.00',
      byInvoicePayable: '200.00',
      completionSettlement: '200.00',
    })
    expect(page.items[0]).toMatchObject({
      settlementStatus: null,
      clearanceStatus: null,
    })
  })

  it('详情保留付款、过程/完工结算二级分组和材料领用真实缺关系空态', () => {
    const detail = buildSubcontractContractDetail({
      contracts: [contract],
      facts,
      query: { id: contract.id, origin: 'real', includeDemo: false },
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'subcontract-contract-v1',
      capabilities: ['subcontract-contract:read', 'subcontract-contract:write', 'subcontract-document:read'],
    })

    expect(detail.sections.payments.applications).toHaveLength(1)
    expect(detail.sections.payments.records).toHaveLength(1)
    expect(detail.sections.settlements.progress).toHaveLength(1)
    expect(detail.sections.settlements.completion).toHaveLength(1)
    expect(detail.sections.changes).toEqual([
      expect.objectContaining({
        id: 'sub-change-327',
        navigation: expect.objectContaining({
          kind: 'entity-detail',
          subject: expect.objectContaining({ entity: 'subcontract-document', id: 'sub-change-327' }),
          variant: 'change',
          filters: {
            dataOrigin: 'real',
            projectId: 'project-321',
            supplierId: 'supplier-321',
            contractId: 'subcontract-321',
          },
        }),
      }),
    ])
    expect(detail.sections.materialUses).toEqual({
      currentWarehouse: [],
      legacy: [],
      emptyReason: 'missing-relation',
    })
  })

  it('缺少分包变洽签读取权限时，合同事实不生成假可点击目标', () => {
    const detail = buildSubcontractContractDetail({
      contracts: [contract],
      facts,
      query: { id: contract.id, origin: 'real', includeDemo: false, focusId: null },
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'subcontract-contract-v1',
      capabilities: ['subcontract-contract:read'],
    })

    expect(detail.sections.changes[0]?.navigation)
      .toEqual({ kind: 'unavailable', reason: 'forbidden' })
  })

  describe('直接深链按稳定补充协议 ID 区分父合同错配与目标不存在', () => {
    const otherContract = { ...contract, id: 'subcontract-322', no: 'FB-2026-0322', name: '其他分包合同' }
    const focusFacts: SubcontractContractFactSources = {
      ...facts,
      supplements: [{
        dataOrigin: 'real',
        id: 'supplement-other-contract',
        contractId: otherContract.id,
        no: 'BC-2',
        name: '其他分包补充协议',
        amount: 120,
        date: '2026-08-03',
        status: '生效',
      }],
    }
    const build = (focusId: string) => buildSubcontractContractDetail({
      contracts: [contract, otherContract],
      facts: focusFacts,
      query: parseSubcontractContractDetailQuery(contract.id, { origin: 'real', focusId }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'subcontract-contract-v2',
      capabilities: ['subcontract-contract:read'],
    })
    it.each([
      { case: '\'supplement-other-contract\'', input: 'supplement-other-contract', expected: /补充协议与分包合同不匹配/ },
      { case: '\'missing-supplement\'', input: 'missing-supplement', expected: /聚焦的分包合同事实不存在/ },
    ])('build：$case', ({ input, expected }) => {
      expect(() => build(structuredClone(input))).toThrowError(expected)
    })
  })

  it('合同变洽签页签可按稳定变洽签 ID 聚焦同一合同事实', () => {
    const detail = buildSubcontractContractDetail({
      contracts: [contract],
      facts,
      query: parseSubcontractContractDetailQuery(contract.id, { origin: 'real', focusId: 'sub-change-327' }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'subcontract-contract-v3',
      capabilities: ['subcontract-contract:read'],
    })

    expect(detail.sections.changes).toContainEqual(expect.objectContaining({ id: 'sub-change-327' }))
  })

  it('演示合同中的未核验变洽签事实不生成可点击的正式详情目标', () => {
    const detail = buildSubcontractContractDetail({
      contracts: [{ ...contract, dataOrigin: 'demo' }],
      facts: {
        ...facts,
        changes: [{ ...facts.changes[0]!, dataOrigin: 'demo', id: 'sub-change-1' }],
      },
      query: parseSubcontractContractDetailQuery(contract.id, { origin: 'demo', includeDemo: true }),
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'subcontract-contract-demo-v1',
      capabilities: ['subcontract-contract:read', 'demo:read'],
    })

    expect(detail.sections.changes[0]?.navigation)
      .toEqual({ kind: 'unavailable', reason: 'unverified-target' })
  })

  it('拒绝不能形成 canonical focus 的补充协议 ID', () => {
    expect(() => parseSubcontractContractDetailQuery(contract.id, {
      origin: 'real',
      focusId: '\0',
    })).toThrowError(/查询参数无效/)
  })
})

describe('分包合同未知金额连续投影', () => {
  it.each(['supplements', 'settlements', 'invoices', 'paymentRecords'] as const)('有效 %s 未知沿对应应付链传播', (kind) => {
    const current = structuredClone(facts)
    current[kind][0]!.amount = null
    const input = { contracts: [contract], facts: current, asOf: contract.updatedAt, sourceVersion: 'nullable-fixture', capabilities: [] }
    const detail = buildSubcontractContractDetail({ ...input, query: parseSubcontractContractDetailQuery(contract.id, { origin: 'real' }) })
    const expected = kind === 'supplements'
      ? { changed: null, settled: '900.00', invoiced: '600.00', paid: '400.00', bySettlementPayable: '500.00', byInvoicePayable: '200.00' }
      : kind === 'settlements'
        ? { changed: '1100.00', settled: null, invoiced: '600.00', paid: '400.00', bySettlementPayable: null, byInvoicePayable: '200.00' }
        : kind === 'invoices'
          ? { changed: '1100.00', settled: '900.00', invoiced: null, paid: '400.00', bySettlementPayable: '500.00', byInvoicePayable: null }
          : { changed: '1100.00', settled: '900.00', invoiced: '600.00', paid: null, bySettlementPayable: null, byInvoicePayable: null }
    expect(detail.contract.amounts).toMatchObject(expected)
    expect(detail.contract.amounts.contract).toBe('1000.00')
    const page = buildSubcontractContractListPage({ ...input, query: parseSubcontractContractListQuery({}) })
    expect(page.summary.origins.real).toEqual({ contractCount: 1, changedAmount: expected.changed, settledAmount: expected.settled, paidAmount: expected.paid })
  })
  it('未知主合同与有效空集合分别保持NULL和真实零，draft未知协议不纳入', () => {
    const empty = Object.fromEntries(Object.keys(facts).map(key => [key, []])) as unknown as SubcontractContractFactSources
    const read = (amount: number | null) => buildSubcontractContractDetail({ contracts: [{ ...contract, amount }], facts: empty, query: parseSubcontractContractDetailQuery(contract.id, { origin: 'real' }), asOf: contract.updatedAt, sourceVersion: 'nullable-fixture', capabilities: [] }).contract.amounts
    expect(read(null)).toEqual({ contract: null, changed: null, settled: '0.00', invoiced: '0.00', paid: '0.00', bySettlementPayable: '0.00', byInvoicePayable: '0.00', completionSettlement: '0.00' })
    expect(read(0)).toEqual({ contract: '0.00', changed: '0.00', settled: '0.00', invoiced: '0.00', paid: '0.00', bySettlementPayable: '0.00', byInvoicePayable: '0.00', completionSettlement: '0.00' })
    empty.supplements = [{ ...facts.supplements[0]!, amount: null, status: 'draft' }]
    expect(read(0).changed).toBe('0.00')
  })
})

describe('subcontract 列表汇总公开边界', () => {
  it('允许真实未知金额，拒绝把未知行汇总成零、畸形金额和错误总数', () => {
    const query = parseSubcontractContractListQuery({})
    const input = { contracts: [{ ...contract, amount: null }], facts, query, asOf: '2026-08-25T00:00:00.000Z', sourceVersion: 'unknown-owner-v1', capabilities: ['subcontract-contract:read'] }
    const evidence = { ...input, schemaVersion: 'subcontract-contract-read-v2', scope: query, requested: true }
    const page = withOriginReadMeta(buildSubcontractContractListPage(input), { real: publicReadMeta({ ...evidence, dataOrigin: 'real' }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo', requested: false }) })
    expect(page.summary.origins.real.changedAmount).toBeNull()
    expect(decodeSubcontractContractListPage(page).summary.origins.real.changedAmount).toBeNull()
    for (const patch of [{ changedAmount: '0.00' }, { changedAmount: 'NaN' }, { changedAmount: 0 }, { contractCount: -1 }, { contractCount: 2 }]) {
      const summary = { ...page.summary, origins: { ...page.summary.origins, real: { ...page.summary.origins.real, ...patch } } }
      expect(() => decodeSubcontractContractListPage({ ...page, summary })).toThrow('无效')
    }
  })
})
