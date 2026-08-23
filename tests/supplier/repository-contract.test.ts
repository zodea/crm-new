import type { SupplierListSourceRow } from '~/lib/supplier/repository'
import { describe, expect, it } from 'vitest'
import {
  buildSupplierDetailRead,
  buildSupplierListPage,
  parseSupplierDetailQuery,
  parseSupplierListQuery,
} from '~/lib/supplier/repository'

const AS_OF = '2026-08-23T00:00:00.000Z'

function supplier(
  id: string,
  name: string,
  overrides: Partial<SupplierListSourceRow> = {},
): SupplierListSourceRow {
  return {
    dataOrigin: 'real',
    id,
    name,
    aliases: [],
    externalRef: '',
    uniqueCode: '91440101TEST000001',
    taxNo: '91440101TEST000001',
    businessType: '材料采购',
    supplierCategory: '材料供应商',
    rating: 'A',
    legalRep: '陈先生',
    registeredCapital: null,
    registeredDate: null,
    address: '广州市天河区测试路 1 号',
    taxpayerType: '一般纳税人',
    mainBusiness: '建筑材料',
    invoiceName: name,
    invoiceAddress: '广州市天河区测试路 1 号',
    bank: '中国银行广州分行',
    bankAccount: '6217850012345678',
    phone: '02088886666',
    contact: '陈经理',
    contactPhone: '13800001234',
    contactTitle: '业务经理',
    credentialStatus: 'qualified',
    note: '',
    updatedAt: AS_OF,
    ...overrides,
  }
}

describe('分供方中央 Repository contract', () => {
  it('列表在中央侧筛选分页并只返回语义详情目标', () => {
    const page = buildSupplierListPage({
      suppliers: [
        supplier('supplier-2', '第二分供方', { supplierCategory: '专业分包商' }),
        supplier('supplier-1', '中央分供方', { aliases: ['中央材料'], credentialStatus: 'qualified' }),
      ],
      projectSuppliers: [],
      contracts: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      query: parseSupplierListQuery({
        includeDemo: 'false',
        search: '中央材料',
        category: '材料供应商',
        credentialStatus: 'qualified',
        sort: 'name-asc',
        page: '1',
        pageSize: '10',
      }),
      asOf: AS_OF,
      sourceVersion: 'supplier-list-v1',
      capabilities: ['supplier:list:read'],
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      dataOrigin: 'real',
      supplier: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '中央分供方' },
      navigation: { kind: 'entity-detail', variant: 'detail', filters: { dataOrigin: 'real' } },
      taxNo: '9144 **** 0001',
      contactPhone: '138 **** 1234',
      projectCount: 0,
      contractAmount: '0.00',
      paymentAmount: '0.00',
    })
    expect(JSON.stringify(page.items[0]?.navigation)).not.toContain('/base/supplier')
    const serialized = JSON.stringify(page)
    expect(serialized).not.toContain('91440101TEST000001')
    expect(serialized).not.toContain('6217850012345678')
    expect(serialized).not.toContain('13800001234')
    expect(page.pagination).toEqual({ page: 1, pageSize: 10, total: 1 })
    expect(page.empty).toBeNull()
  })

  it('四类事实为零时仍返回稳定下钻，并在无 capability 时脱敏', () => {
    const detail = buildSupplierDetailRead({
      suppliers: [supplier('supplier-1', '中央分供方')],
      projects: [],
      projectSuppliers: [],
      contracts: [],
      settlements: [],
      invoices: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      query: parseSupplierDetailQuery('supplier-1', {
        origin: 'real',
        includeDemo: 'false',
      }),
      asOf: AS_OF,
      sourceVersion: 'supplier-v1',
      capabilities: ['supplier:list:read'],
    })

    expect(detail.supplier).toMatchObject({
      id: 'supplier-1',
      taxNo: '9144 **** 0001',
      bankAccount: '6217 **** 5678',
      contactPhone: '138 **** 1234',
    })
    expect(detail.summary).toMatchObject({
      contractAmount: {
        value: '0.00',
        status: 'complete',
        drilldown: { entity: 'contract', filters: { supplierId: 'supplier-1' } },
      },
      settlementAmount: {
        value: '0.00',
        status: 'complete',
        drilldown: { entity: 'settlement', filters: { supplierId: 'supplier-1' } },
      },
      invoiceAmount: {
        value: '0.00',
        status: 'complete',
        drilldown: { entity: 'invoice', filters: { supplierId: 'supplier-1' } },
      },
      paymentAmount: {
        value: '0.00',
        status: 'complete',
        drilldown: { entity: 'payment-record', filters: { supplierId: 'supplier-1' } },
      },
      payableAmount: {
        value: '0.00',
        status: 'complete',
        drilldown: null,
      },
    })
    expect(detail.contracts).toEqual([])
    expect(detail.settlements).toEqual([])
    expect(detail.invoices).toEqual([])
    expect(detail.payments).toEqual([])
  })

  it('四类事实只按稳定 ID 聚合，并保留 missing-relation 与 forbidden', () => {
    const detail = buildSupplierDetailRead({
      suppliers: [supplier('supplier-1', '中央分供方')],
      projects: [
        { dataOrigin: 'real', id: 'project-1', name: '可见项目', status: '施工中', permission: 'allowed' },
        { dataOrigin: 'real', id: 'project-secret', name: '不可泄露项目', status: '施工中', permission: 'forbidden' },
      ],
      projectSuppliers: [{
        dataOrigin: 'real',
        id: 'project-supplier-1',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        status: 'contracted',
      }],
      contracts: [{
        dataOrigin: 'real',
        id: 'contract-1',
        supplierId: 'supplier-1',
        projectId: 'project-1',
        no: 'HT-001',
        name: '材料采购合同',
        kind: '材料',
        amount: 100,
        supplementAmount: 10,
        signDate: '2026-01-01',
        status: '履约中',
      }],
      settlements: [{
        dataOrigin: 'real',
        id: 'settlement-1',
        supplierId: 'supplier-1',
        projectId: null,
        contractId: 'contract-1',
        no: 'JS-001',
        name: '材料过程结算',
        settlementType: '过程结算',
        totalAmount: 25,
        settlementDate: '2026-02-01',
        status: 'confirmed',
      }],
      invoices: [{
        dataOrigin: 'real',
        id: 'invoice-1',
        supplierId: 'supplier-1',
        projectId: 'project-secret',
        contractId: 'contract-1',
        invoiceNumber: 'FP-001',
        invoiceType: '增值税专用发票',
        invoiceDate: '2026-03-01',
        totalAmount: 8,
        taxAmount: 1,
        accountStatus: 'archived',
      }],
      paymentApplications: [{
        dataOrigin: 'real',
        id: 'payment-application-1',
        supplierId: 'supplier-1',
        projectId: 'project-1',
        contractId: 'contract-1',
        no: 'FK-001',
        name: '材料付款申请',
        applyAmount: 60,
        approvedAmount: 50,
        applyDate: '2026-04-01',
        status: 'approved',
      }],
      paymentRecords: [{
        dataOrigin: 'real',
        id: 'payment-record-1',
        supplierId: 'supplier-1',
        projectId: 'project-1',
        no: 'ZF-001',
        amount: 40,
        paymentDate: '2026-04-02',
        confirmationStatus: 'confirmed',
      }],
      paymentAllocations: [{
        dataOrigin: 'real',
        id: 'payment-allocation-1',
        paymentRecordId: 'payment-record-1',
        paymentApplicationId: 'payment-application-1',
        allocatedAmount: 40,
      }],
      query: parseSupplierDetailQuery('supplier-1', { origin: 'real' }),
      asOf: AS_OF,
      sourceVersion: 'supplier-v2',
      capabilities: ['supplier:list:read', 'supplier:sensitive:read'],
    })

    expect(detail.summary).toMatchObject({
      projectCount: 1,
      contractCount: 1,
      settlementCount: 1,
      invoiceCount: 1,
      paymentCount: 1,
      contractAmount: { value: '110.00' },
      settlementAmount: { value: '25.00' },
      invoiceAmount: { value: '8.00' },
      paymentAmount: { value: '40.00' },
      payableAmount: { value: '70.00' },
    })
    expect(detail.projects[0]).toMatchObject({
      relationId: 'project-supplier-1',
      project: { state: 'resolved', entity: 'project', id: 'project-1' },
      navigation: { kind: 'entity-subview', filters: { supplierId: 'supplier-1' } },
    })
    expect(detail.contracts[0]).toMatchObject({
      contract: { state: 'resolved', entity: 'contract', id: 'contract-1' },
      project: { state: 'resolved', entity: 'project', id: 'project-1' },
      effectiveAmount: '110.00',
    })
    expect(detail.settlements[0]).toMatchObject({
      settlement: { state: 'resolved', entity: 'settlement', id: 'settlement-1' },
      project: { state: 'missing', entity: 'project', id: null },
      totalAmount: '25.00',
    })
    expect(detail.invoices[0]).toMatchObject({
      invoice: { state: 'resolved', entity: 'invoice', id: 'invoice-1' },
      project: { state: 'forbidden', entity: 'project', id: 'project-secret', label: null },
      totalAmount: '8.00',
    })
    expect(detail.payments[0]).toMatchObject({
      application: { state: 'resolved', entity: 'payment-application', id: 'payment-application-1' },
      actualPaidAmount: '40.00',
    })
    expect(JSON.stringify(detail)).not.toContain('/base/supplier')
  })
})
