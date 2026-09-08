import type {
  MaterialContractDetailSource,
  MaterialContractFactSources,
} from '~/lib/material-contract/repository'
import { describe, expect, it } from 'vitest'
import {
  buildMaterialContractDetail,
  buildMaterialContractListPage,
  parseMaterialContractDetailQuery,
  parseMaterialContractListQuery,
} from '~/lib/material-contract/repository'

const AS_OF = '2026-08-24T00:00:00.000Z'

function detailSource(
  overrides: Partial<MaterialContractDetailSource> = {},
): MaterialContractDetailSource {
  return {
    dataOrigin: 'real',
    id: 'contract-material-1',
    no: 'CG-001',
    name: '中央材料采购合同',
    kind: '材采',
    projectId: 'project-1',
    projectName: '中央项目',
    projectReferenceState: 'resolved',
    supplierId: 'supplier-1',
    supplierName: '中央分供方',
    supplierReferenceState: 'resolved',
    amount: 1000,
    supplementAmount: 100,
    settledAmount: 0,
    invoicedAmount: 0,
    paidAmount: 0,
    content: '瓷砖采购',
    invoiceType: '增值税专用发票',
    contactName: '陈经理',
    contactPhone: '13800001234',
    taxRate: 13,
    signDate: '2026-08-01',
    mainTerms: '按月对账',
    paymentTerms: '结算后付款',
    brandQualityTerms: '符合国标',
    scheduleTerms: '分批到货',
    warrantyTerms: '',
    specialTerms: '',
    retentionRatio: 0.123456,
    retentionAmount: null,
    retentionDays: null,
    invoiceName: '广州瑞航',
    invoiceTaxNo: '91440101TEST000001',
    invoiceAddressPhone: '',
    invoiceBank: '',
    invoiceBankAccount: '',
    status: '履约中',
    note: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  }
}

function emptyFacts(): MaterialContractFactSources {
  return {
    lineItems: [],
    materialRequisitions: [],
    materialArrivals: [],
    invoices: [],
    paymentApplications: [],
    paymentRecords: [],
    paymentAllocations: [],
    settlements: [],
    penalties: [],
    files: [],
  }
}

describe('材料采购合同中央 Repository contract', () => {
  it('状态多选在分页前按 OR 匹配并汇总全量结果', () => {
    const page = buildMaterialContractListPage({
      contracts: [
        ...Array.from({ length: 12 }, (_, index) => detailSource({ id: `match-${index}`, status: index % 2 ? '草稿' : '履约中' })),
        detailSource({ id: 'excluded', status: '已结清' }),
      ],
      query: parseMaterialContractListQuery({ status: '["草稿","履约中"]' }),
      asOf: AS_OF,
      sourceVersion: 'multi-filter',
      capabilities: [],
    })
    expect(page.items).toHaveLength(10)
    expect(page.pagination.total).toBe(12)
    expect(page.summary.origins.real).toMatchObject({ contractCount: 12, changedAmount: '13200.00' })
    expect(page.items.every(row => ['草稿', '履约中'].includes(row.status))).toBe(true)
  })

  it('按稳定 ID 返回材采专属详情，并保留六类真实空事实与零金额', () => {
    const detail = buildMaterialContractDetail({
      contracts: [detailSource()],
      facts: emptyFacts(),
      query: parseMaterialContractDetailQuery('contract-material-1', {
        origin: 'real',
        includeDemo: 'false',
      }),
      asOf: AS_OF,
      sourceVersion: 'material-contract-v1',
      capabilities: ['material-contract:read', 'material-contract:write'],
    })

    expect(detail.contract).toMatchObject({
      dataOrigin: 'real',
      id: 'contract-material-1',
      kind: '材采',
      project: { state: 'resolved', entity: 'project', id: 'project-1' },
      supplier: { state: 'resolved', entity: 'supplier', id: 'supplier-1' },
      amounts: {
        contract: '1000.00',
        changed: '1100.00',
        settled: '0.00',
        invoiced: '0.00',
        paid: '0.00',
        payable: '0.00',
      },
      retentionRatio: '0.123456',
    })
    expect(detail.projectNavigation).toMatchObject({
      kind: 'entity-detail',
      subject: { id: 'project-1' },
      filters: { dataOrigin: 'real' },
    })
    expect(detail.supplierNavigation).toMatchObject({
      kind: 'entity-detail',
      subject: { id: 'supplier-1' },
      filters: { dataOrigin: 'real' },
    })
    expect(detail.sections).toEqual({
      lineItems: [],
      materials: {
        requisitions: [],
        arrivals: [],
        directTransfers: [],
        outbound: [],
      },
      invoices: [],
      payments: [],
      settlements: [],
      penalties: [],
      files: [],
    })
    expect(detail.capabilities).toContain('material-contract:write')
  })

  it('分别表达未记录外键、中央目标消失与无权查看，不生成假链接', () => {
    const read = (source: MaterialContractDetailSource) => buildMaterialContractDetail({
      contracts: [source],
      facts: emptyFacts(),
      query: parseMaterialContractDetailQuery(source.id, { origin: source.dataOrigin }),
      asOf: AS_OF,
      sourceVersion: 'material-contract-reference-states-v1',
      capabilities: ['material-contract:read'],
    })

    const missingId = read(detailSource({ projectId: null, projectName: '' }))
    expect(missingId.contract.project).toMatchObject({ state: 'missing', reason: 'not-recorded' })
    expect(missingId.projectNavigation).toEqual({ kind: 'unavailable', reason: 'missing-id' })

    const missingTarget = read(detailSource({
      projectId: 'project-removed',
      projectName: '',
      projectReferenceState: 'missing-target',
    }))
    expect(missingTarget.contract.project).toMatchObject({ state: 'missing', reason: 'not-configured' })
    expect(missingTarget.projectNavigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })

    const forbidden = read(detailSource({ supplierReferenceState: 'forbidden' }))
    expect(forbidden.contract.supplier).toMatchObject({ state: 'forbidden', id: 'supplier-1' })
    expect(forbidden.supplierNavigation).toEqual({ kind: 'unavailable', reason: 'forbidden' })
  })

  it('只按合同稳定 ID 汇总采购明细、物资、票款、结算、罚扣和文件', () => {
    const facts: MaterialContractFactSources = {
      lineItems: [{
        dataOrigin: 'real',
        id: 'line-1',
        contractId: 'contract-material-1',
        materialName: '墙砖',
        spec: '600×600',
        brand: '测试品牌',
        unit: '㎡',
        qty: 1.234567,
        taxInclusiveUnitPrice: 25.5,
        plannedArrivalDate: '2026-09-01',
        note: '',
        sortOrder: 1,
      }],
      materialRequisitions: [{
        dataOrigin: 'real',
        id: 'requisition-1',
        contractId: 'contract-material-1',
        no: 'XQ-001',
        name: '墙砖需用计划',
        amount: null,
        date: '2026-08-10',
        status: 'submitted',
      }],
      materialArrivals: [{
        dataOrigin: 'real',
        id: 'arrival-1',
        contractId: 'contract-material-1',
        no: 'DH-001',
        name: '第一批到货',
        amount: 255,
        date: '2026-08-12',
        status: 'confirmed',
      }],
      invoices: [{
        dataOrigin: 'real',
        id: 'invoice-1',
        contractId: 'contract-material-1',
        no: 'FP-001',
        name: '增值税专用发票',
        amount: 100,
        date: '2026-08-15',
        status: 'archived',
      }],
      paymentApplications: [{
        dataOrigin: 'real',
        id: 'payment-application-1',
        contractId: 'contract-material-1',
        no: 'FK-001',
        name: '材料进度款',
        amount: 80,
        date: '2026-08-16',
        status: 'approved',
      }],
      paymentRecords: [{
        dataOrigin: 'real',
        id: 'payment-record-1',
        no: 'ZF-001',
        amount: 50,
        confirmationStatus: 'confirmed',
        paymentDate: '2026-08-17',
      }],
      paymentAllocations: [{
        dataOrigin: 'real',
        paymentRecordId: 'payment-record-1',
        paymentApplicationId: 'payment-application-1',
        allocatedAmount: 50,
      }],
      settlements: [{
        dataOrigin: 'real',
        id: 'settlement-1',
        contractId: 'contract-material-1',
        no: 'JS-001',
        name: '材料过程结算',
        amount: 90,
        date: '2026-08-18',
        status: 'confirmed',
      }],
      penalties: [{
        dataOrigin: 'real',
        id: 'penalty-1',
        contractId: 'contract-material-1',
        no: 'FK-001',
        name: '材料延误罚扣',
        amount: 5,
        date: '2026-08-19',
        status: 'confirmed',
      }, {
        dataOrigin: 'real',
        id: 'penalty-other',
        contractId: 'contract-other',
        no: 'FK-OTHER',
        name: '同名材料延误罚扣',
        amount: 999,
        date: '2026-08-19',
        status: 'confirmed',
      }],
      files: [{
        dataOrigin: 'real',
        id: 'file-1',
        contractId: 'contract-material-1',
        fileName: '材料采购合同.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        category: '正式合同',
        uploadedAt: '2026-08-01T00:00:00.000Z',
      }],
    }

    const detail = buildMaterialContractDetail({
      contracts: [detailSource()],
      facts,
      query: parseMaterialContractDetailQuery('contract-material-1', { origin: 'real' }),
      asOf: AS_OF,
      sourceVersion: 'material-contract-v2',
      capabilities: ['material-contract:read'],
    })

    expect(detail.sections.lineItems[0]).toMatchObject({
      id: 'line-1',
      qty: '1.234567',
      unitPrice: '25.50',
      amount: '31.48',
    })
    expect(detail.sections.materials.requisitions[0]).toMatchObject({
      id: 'requisition-1',
      navigation: { kind: 'unavailable', reason: 'unverified-target' },
    })
    expect(detail.sections.invoices[0]).toMatchObject({
      id: 'invoice-1',
      amount: '100.00',
      navigation: { kind: 'unavailable', reason: 'unverified-target' },
    })
    expect(detail.sections.payments[0]).toMatchObject({
      id: 'payment-application-1',
      amount: '80.00',
      paidAmount: '50.00',
      navigation: { kind: 'unavailable', reason: 'unverified-target' },
    })
    expect(detail.sections.settlements[0]).toMatchObject({
      id: 'settlement-1',
      navigation: { kind: 'unavailable', reason: 'unverified-target' },
    })
    expect(detail.sections.penalties.map(row => row.id)).toEqual(['penalty-1'])
    expect(detail.sections.files[0]).toMatchObject({ id: 'file-1', fileName: '材料采购合同.pdf' })
  })

  it('列表在中央侧按稳定关系筛选分页，演示数据默认不进入正式汇总', () => {
    const page = buildMaterialContractListPage({
      contracts: [
        detailSource(),
        detailSource({
          dataOrigin: 'demo',
          id: 'contract-demo-1',
          no: 'CG-DEMO-001',
          name: '测试材料采购合同',
          projectId: 'project-demo',
          projectName: '测试项目',
          supplierId: 'supplier-demo',
          supplierName: '测试分供方',
          amount: 9999,
        }),
      ],
      query: parseMaterialContractListQuery({
        search: '中央',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        status: '履约中',
        page: '1',
        pageSize: '10',
      }),
      asOf: AS_OF,
      sourceVersion: 'material-contract-list-v1',
      capabilities: ['material-contract:read'],
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      rowKey: 'real:contract-material-1',
      dataOrigin: 'real',
      id: 'contract-material-1',
      navigation: {
        kind: 'entity-detail',
        subject: { entity: 'contract', id: 'contract-material-1' },
        filters: { dataOrigin: 'real', contractKind: '材采' },
      },
      project: { state: 'resolved', id: 'project-1' },
      supplier: { state: 'resolved', id: 'supplier-1' },
      amounts: { changed: '1100.00', invoiced: '0.00', paid: '0.00' },
    })
    expect(page.pagination).toEqual({ page: 1, pageSize: 10, total: 1 })
    expect(page.summary.origins).toEqual({
      real: { contractCount: 1, changedAmount: '1100.00', invoicedAmount: '0.00', paidAmount: '0.00' },
      demo: { contractCount: 0, changedAmount: '0.00', invoicedAmount: '0.00', paidAmount: '0.00' },
    })
  })

  it('正式与演示来源即使合同 ID 相同也生成不同表格稳定键', () => {
    const page = buildMaterialContractListPage({
      contracts: [detailSource(), detailSource({ dataOrigin: 'demo' })],
      query: parseMaterialContractListQuery({ includeDemo: 'true' }),
      asOf: AS_OF,
      sourceVersion: 'material-contract-list-v2',
      capabilities: ['material-contract:read'],
    })

    expect(page.items.map(row => row.rowKey).sort()).toEqual([
      'demo:contract-material-1',
      'real:contract-material-1',
    ])
  })
})
