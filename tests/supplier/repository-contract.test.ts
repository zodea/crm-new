import type { SupplierListSourceRow } from '~/lib/supplier/repository'
import { describe, expect, it } from 'vitest'
import {
  buildSupplierDetailRead,
  buildSupplierListPage,
  decodeSupplierDetailRead,
  decodeSupplierListPage,
  parseSupplierDetailQuery,
  parseSupplierListQuery,
  serializeSupplierListQuery,
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
  it('固定枚举多选同字段取并集、跨字段取交集，分页汇总与自身排除 facet 同步', () => {
    const suppliers = Array.from({ length: 30 }, (_, index) => supplier(`multi-${index}`, `多选 ${index}`, {
      supplierCategory: ['材料供应商', '劳务分包商', '设备供应商'][index % 3]!,
      credentialStatus: index < 20 ? 'qualified' : 'reviewing',
      taxpayerType: index % 2 ? '小规模纳税人' : '一般纳税人',
    }))
    const input = { suppliers, projectSuppliers: [], contracts: [], paymentApplications: [], paymentRecords: [], paymentAllocations: [], asOf: AS_OF, sourceVersion: 'multi-enum', capabilities: [] }
    const query = parseSupplierListQuery({ category: ['材料供应商', '劳务分包商'], credentialStatus: ['qualified', 'reviewing'], columnFilters: { taxpayerType: ['一般纳税人', '小规模纳税人'] }, pageSize: 10, page: 2 })
    expect(parseSupplierListQuery(serializeSupplierListQuery(query))).toEqual(query)
    const result = buildSupplierListPage({ ...input, query })
    expect(result.pagination).toEqual({ page: 2, pageSize: 10, total: 20 })
    expect(result.summary.origins.real.supplierCount).toBe(20)
    expect(result.summary.categories).toEqual(expect.arrayContaining([{ value: '设备供应商', label: '设备供应商', count: 10 }]))
    const narrowed = buildSupplierListPage({ ...input, query: { ...query, credentialStatus: ['qualified'], columnFilters: { taxpayerType: ['一般纳税人'] } } })
    expect(narrowed.pagination).toEqual({ page: 1, pageSize: 10, total: 7 })
    expect(narrowed.items.every(item => ['材料供应商', '劳务分包商'].includes(item.supplierCategory) && item.credentialStatus === 'qualified' && item.taxpayerType === '一般纳税人')).toBe(true)
    expect(narrowed.summary.taxpayerTypes).toEqual(expect.arrayContaining([{ value: '小规模纳税人', label: '小规模纳税人', count: 7 }]))
    expect(buildSupplierListPage({ ...input, query: { ...query, category: [], credentialStatus: [], columnFilters: { taxpayerType: [] } } }).pagination.total).toBe(30)
  })

  it('多选编码兼容旧单值和重复参数，去重空白并拒绝非字符串选项', () => {
    const single = parseSupplierListQuery({ category: '材料供应商', credentialStatus: 'qualified', columnFilters: { taxpayerType: '一般纳税人' } })
    expect(single).toMatchObject({ category: ['材料供应商'], credentialStatus: ['qualified'], columnFilters: { taxpayerType: ['一般纳税人'] } })
    expect(serializeSupplierListQuery(single)).toMatchObject({ category: '材料供应商', credentialStatus: 'qualified' })
    const repeated = parseSupplierListQuery({ category: [' 材料供应商 ', '劳务分包商', '材料供应商', ''], credentialStatus: '["qualified","reviewing","qualified"]' })
    expect(repeated.category).toEqual(expect.arrayContaining(['材料供应商', '劳务分包商']))
    expect(repeated.category).toHaveLength(2)
    expect(repeated.credentialStatus).toHaveLength(2)
    expect(parseSupplierListQuery(serializeSupplierListQuery(repeated))).toEqual(repeated)
    for (const value of [[12], ['qualified', null], {}, '[broken']) {
      expect(() => parseSupplierListQuery({ credentialStatus: value })).toThrow()
      expect(() => parseSupplierListQuery({ columnFilters: { taxpayerType: value } })).toThrow()
    }
    expect(parseSupplierListQuery({ category: 'all', credentialStatus: '[]' })).toMatchObject({ category: null, credentialStatus: null })
    expect(parseSupplierListQuery({ credentialStatus: ['legacy-state'] }).credentialStatus).toEqual(['legacy-state'])
  })

  it.each([false, true])('短敏感值在列表、详情和复制后查询保持一致（敏感权限：%s）', (canReadSensitive) => {
    const raw = { uniqueCode: 'SUP-001', taxNo: 'TAX-01', bankAccount: '1234567', contactPhone: '12345' }
    const visible = canReadSensitive ? raw : { uniqueCode: 'SUP- **** 01', taxNo: 'TAX- **** 1', bankAccount: '1234 **** 67', contactPhone: '123 **** 5' }
    const input = {
      suppliers: [supplier('supplier-1', '短编码验证', raw)],
      projects: [],
      projectSuppliers: [],
      contracts: [],
      settlements: [],
      invoices: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      asOf: AS_OF,
      sourceVersion: 'single-mask',
      capabilities: canReadSensitive ? ['supplier:sensitive:read'] : [],
    }
    const page = buildSupplierListPage({ ...input, query: parseSupplierListQuery({}) })
    const detail = buildSupplierDetailRead({ ...input, query: parseSupplierDetailQuery('supplier-1', {}) })
    expect(page.items[0]).toMatchObject(visible)
    expect(page.items[0]?.supplier.no).toBe(visible.uniqueCode)
    expect(detail.supplier).toMatchObject(visible)
    for (const field of ['uniqueCode', 'taxNo'] as const) {
      const search = page.items[0]![field]
      expect(buildSupplierListPage({ ...input, query: parseSupplierListQuery({ search }) }).items).toHaveLength(1)
    }
    for (const field of ['uniqueCode', 'taxNo', 'bankAccount', 'contactPhone'] as const) {
      const contains = { [field]: page.items[0]![field] }
      expect(buildSupplierListPage({ ...input, query: parseSupplierListQuery({ columnFilters: { contains } }) }).items).toHaveLength(1)
    }
    expect(buildSupplierListPage({ ...input, query: parseSupplierListQuery({ search: raw.uniqueCode }) }).items).toHaveLength(canReadSensitive ? 1 : 0)
    expect(input.suppliers[0]).toMatchObject(raw)
  })

  it('列表和详情使用同一有效合同与确认结算口径，缺金额保留 partial 与 null', () => {
    const contract = { dataOrigin: 'real' as const, id: 'contract', supplierId: 'supplier', projectId: null, no: '', name: '', kind: '分包', amount: 100, supplementAmount: 20, signDate: null, status: '生效' }
    const settlement = { dataOrigin: 'real' as const, id: 'settlement', supplierId: 'supplier', projectId: null, contractId: contract.id, no: '', name: '', settlementType: 'progress', totalAmount: 30, settlementDate: null, status: 'confirmed' }
    const input = { suppliers: [supplier('supplier', '统计验证')], projects: [], projectSuppliers: [], contracts: [contract, { ...contract, id: 'draft', amount: 999, status: '草稿' }, { ...contract, id: 'cancelled', amount: 888, status: 'cancelled' }], settlements: [settlement, { ...settlement, id: 'approval-is-not-confirmation', totalAmount: 777, status: 'approved' }], invoices: [], paymentApplications: [], paymentRecords: [], paymentAllocations: [], asOf: AS_OF, sourceVersion: 'facts', capabilities: [] }
    const list = buildSupplierListPage({ ...input, query: parseSupplierListQuery({}) })
    const detail = buildSupplierDetailRead({ ...input, query: parseSupplierDetailQuery('supplier', {}) })
    expect(list.items[0]).toMatchObject({ cumulativeContractAmount: '120.00', contractAmount: '120.00', settlementAmount: '30.00' })
    expect(detail.summary.contractAmount.value).toBe('120.00')
    expect(detail.summary.settlementAmount.value).toBe('30.00')
    const unknown = { ...input, contracts: [{ ...contract, supplementAmount: null }], settlements: [{ ...settlement, totalAmount: null }] }
    const unknownList = decodeSupplierListPage(buildSupplierListPage({ ...unknown, query: parseSupplierListQuery({}) }))
    const unknownDetail = decodeSupplierDetailRead(buildSupplierDetailRead({ ...unknown, query: parseSupplierDetailQuery('supplier', {}) }))
    expect(unknownList.items[0]).toMatchObject({ cumulativeContractAmount: null, contractAmount: null, settlementAmount: null })
    expect(unknownList.summary.origins.real.contractAmount).toBeNull()
    expect(unknownDetail.contracts[0]?.effectiveAmount).toBeNull()
    expect(unknownDetail.settlements[0]?.totalAmount).toBeNull()
    expect(unknownDetail.summary.contractAmount).toMatchObject({ value: null, status: 'partial', missingSources: ['contract'] })
    expect(unknownDetail.summary.settlementAmount).toMatchObject({ value: null, status: 'partial', missingSources: ['settlement'] })
    expect(unknownDetail.summary.payableAmount.value).toBeNull()
    expect(buildSupplierListPage({ ...unknown, query: parseSupplierListQuery({ columnFilters: { ranges: { contractAmount: { min: 0 } } } }) }).items).toEqual([])
  })

  it('表头条件先筛完整集合，数值排序分页，facet不被自身选中值锁死', () => {
    const suppliers = Array.from({ length: 25 }, (_, index) => supplier(`supplier-${index}`, `列表 ${index}`, {
      laborScope: index < 22 ? '石材安装' : '电梯安装',
      taxpayerType: index % 2 ? '小规模纳税人' : '一般纳税人',
    }))
    const input = {
      suppliers,
      projectSuppliers: [],
      contracts: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      asOf: AS_OF,
      sourceVersion: 'query-test',
      capabilities: [],
    }
    const query = parseSupplierListQuery({ page: 2, pageSize: 10, sort: 'projectCount-desc', columnFilters: JSON.stringify({ contains: { laborScope: ' 石材 ' }, ranges: { projectCount: { min: 0, max: 0 } } }) })
    expect(parseSupplierListQuery(serializeSupplierListQuery(query))).toEqual(query)
    const page = buildSupplierListPage({ ...input, query })
    expect(page.pagination).toEqual({ page: 2, pageSize: 10, total: 22 })
    expect(page.items).toHaveLength(10)
    const clamped = buildSupplierListPage({ ...input, query: { ...query, page: 999 } })
    expect(clamped.pagination).toEqual({ page: 3, pageSize: 10, total: 22 })
    expect(clamped.items).toHaveLength(2)
    expect(page.summary.origins.real.supplierCount).toBe(22)
    const selected = buildSupplierListPage({ ...input, query: parseSupplierListQuery({ columnFilters: { taxpayerType: '一般纳税人' } }) })
    expect(selected.summary.taxpayerTypes).toEqual(expect.arrayContaining([
      { value: '一般纳税人', label: '一般纳税人', count: 13 },
      { value: '小规模纳税人', label: '小规模纳税人', count: 12 },
    ]))
  })

  it('敏感查询只匹配可见值；真实零结算与未接入分开，草稿不计入累计', () => {
    const input = {
      suppliers: [supplier('supplier-1', '来源验证')],
      projectSuppliers: [],
      contracts: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      asOf: AS_OF,
      sourceVersion: 'fact-test',
      capabilities: [],
    }
    expect(buildSupplierListPage({ ...input, query: parseSupplierListQuery({ search: '6217850012345678' }) }).items).toEqual([])
    expect(buildSupplierListPage({ ...input, query: parseSupplierListQuery({ columnFilters: { contains: { bankAccount: '6217850012345678' } } }) }).items).toEqual([])
    const noSource = buildSupplierListPage({ ...input, query: parseSupplierListQuery({}) })
    expect(noSource.items[0]).toMatchObject({ settlementAmount: null, laborScope: '', businessLicense: { state: 'unavailable', fileCount: null, fileIds: [] } })
    const confirmed = { dataOrigin: 'real' as const, id: 's-1', supplierId: 'supplier-1', projectId: null, contractId: null, no: 'S1', name: '真实结算', settlementType: 'final', totalAmount: 18, settlementDate: null, status: 'confirmed' }
    const page = buildSupplierListPage({ ...input, settlements: [confirmed, { ...confirmed, id: 's-2', totalAmount: 90, status: 'draft' }], query: parseSupplierListQuery({ columnFilters: { ranges: { settlementAmount: { min: 18, max: 18 } } } }) })
    expect(page.items[0]?.settlementAmount).toBe('18.00')
    const oldPayload = structuredClone(noSource) as unknown as { items: Record<string, unknown>[] }
    delete oldPayload.items[0]!.laborScope
    expect(decodeSupplierListPage(oldPayload).items[0]?.laborScope).toBe('')
    for (const columnFilters of [{ contains: { unsupported: 'x' } }, { ranges: { contractAmount: { min: 2, max: 1 } } }, '{broken'])
      expect(() => parseSupplierListQuery({ columnFilters })).toThrow()
  })

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
