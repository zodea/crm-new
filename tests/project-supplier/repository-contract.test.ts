import { describe, expect, it } from 'vitest'
import {
  buildProjectSupplierWorkbenchRead,
  decodeProjectSupplierWorkbenchRead,
  parseProjectSupplierWorkbenchQuery,
  ProjectSupplierRepositoryProblem,
} from '~/lib/project-supplier/repository'

import { withReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

const asOf = '2026-08-24T00:00:00.000Z'

it.each([[null, 'user-entry', 'not-entered', null], [0, 'legacy', 'legacy-unknown', null], [0, 'user-entry', 'known', '0.00']] as const)('工作台请款保留空批复和历史未知，明确零不污染已支付事实：输入案例 %#', (amount, origin, state, expected) => {
  const input = source()
  const result = buildProjectSupplierWorkbenchRead({ ...input, claims: input.claims.map(row => ({ ...row, approvedAmount: amount, approvedAmountOrigin: origin })), query: parseProjectSupplierWorkbenchQuery('project-1', 'supplier-1', { origin: 'demo', includeDemo: 'true' }), asOf, sourceVersion: 'approval', capabilities: ['project-supplier:read', 'demo:read'] })
  expect(result.claims[0]).toMatchObject({ approvedAmount: expected, approvedAmountState: state })
  expect(result.summary).toMatchObject({ claimedTotal: expected, paidTotal: '55.00' })
  const dto = withReadMeta(result, publicReadMeta({ schemaVersion: 'project-supplier-read-v2', dataOrigin: result.dataOrigin, asOf, sourceVersion: result.sourceVersion, capabilities: result.capabilities, scope: { projectId: 'project-1', supplierId: 'supplier-1', origin: 'demo' }, requested: true }))
  expect(decodeProjectSupplierWorkbenchRead(dto)).toEqual(dto)
})

function source() {
  return {
    projects: [
      { dataOrigin: 'demo' as const, id: 'project-1', name: '中央项目', status: '在建', developer: '建设单位', manager: '项目经理' },
      { dataOrigin: 'demo' as const, id: 'project-2', name: '错配项目', status: '在建', developer: '', manager: '' },
    ],
    suppliers: [
      { dataOrigin: 'demo' as const, id: 'supplier-1', name: '中央分供方', supplierCategory: '材料供应商', contact: '陈经理', contactPhone: '13800000000' },
      { dataOrigin: 'demo' as const, id: 'supplier-empty', name: '零事实分供方', supplierCategory: '其他', contact: '', contactPhone: '' },
    ],
    relations: [
      { dataOrigin: 'demo' as const, id: 'relation-1', projectId: 'project-1', supplierId: 'supplier-1', status: 'claiming', note: '按稳定关系聚合' },
      { dataOrigin: 'demo' as const, id: 'relation-empty', projectId: 'project-1', supplierId: 'supplier-empty', status: 'collecting', note: '' },
    ],
    contracts: [{
      dataOrigin: 'demo' as const,
      id: 'contract-1',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      no: 'HT-001',
      name: '材料采购合同',
      kind: '材采',
      status: 'approved',
      amount: 100,
      supplementAmount: 20,
      signDate: '2026-08-01',
      attachmentCount: 1,
    }],
    claims: [{
      dataOrigin: 'demo' as const,
      id: 'claim-1',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      no: 'QK-001',
      name: '首期请款',
      status: 'approved',
      applyAmount: 80,
      approvedAmount: 70,
      applyDate: '2026-08-02',
      invoiceState: '先票后款',
      attachmentCount: 2,
    }],
    invoices: [{
      dataOrigin: 'demo' as const,
      id: 'invoice-1',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-08-03',
      invoiceType: '增值税专用发票',
      totalAmount: 60,
      taxAmount: 6,
      accountStatus: 'archived',
      fileName: '发票.pdf',
    }],
    paymentRecords: [{
      dataOrigin: 'demo' as const,
      id: 'payment-1',
      no: 'ZF-001',
      paymentDate: '2026-08-04',
      paymentMethod: '银行转账',
      voucherNo: 'V-001',
      confirmationStatus: 'confirmed',
      attachmentCount: 1,
    }],
    paymentAllocations: [{
      dataOrigin: 'demo' as const,
      id: 'allocation-1',
      paymentRecordId: 'payment-1',
      paymentApplicationId: 'claim-1',
      allocatedAmount: 55,
    }],
    settlements: [{
      dataOrigin: 'demo' as const,
      id: 'settlement-1',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      no: 'JS-001',
      name: '材料结算',
      settlementType: '材料',
      settlementDate: '2026-08-05',
      totalAmount: 50,
      status: 'confirmed',
      attachmentCount: 1,
    }],
    files: [{
      dataOrigin: 'demo' as const,
      id: 'file-1',
      relationId: 'relation-1',
      ownerType: 'contract',
      ownerId: 'contract-1',
      fileName: '合同扫描件.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      category: '合同',
      uploader: '资料员',
      uploadedAt: '2026-08-06T00:00:00.000Z',
    }],
  }
}

describe('项目×分供方中央 Repository 契约', () => {
  it('无效合同和未确认结算保留追溯行，但不抬高有效汇总', () => {
    const facts = source()
    facts.contracts = ['draft', '草稿', 'cancelled', '作废', '已作废', '无效', 'approved'].map((status, index) => ({
      ...facts.contracts[0],
      id: `contract-${index}`,
      status,
    }))
    facts.settlements = ['approved', '已审批', 'draft', 'confirmed', '已确认'].map((status, index) => ({
      ...facts.settlements[0],
      id: `settlement-${index}`,
      status,
    }))
    const detail = buildProjectSupplierWorkbenchRead({
      ...facts,
      query: parseProjectSupplierWorkbenchQuery('project-1', 'supplier-1', { origin: 'demo', includeDemo: 'true' }),
      asOf,
      sourceVersion: 'fixture-v1',
      capabilities: ['project-supplier:read', 'demo:read'],
    })
    expect(detail.summary).toMatchObject({ contractTotal: '120.00', settlementTotal: '100.00', balance: '65.00' })
    expect(detail.counts).toMatchObject({ contracts: 7, settlements: 5 })
    expect(detail.contracts.map(row => row.status)).toEqual(facts.contracts.map(row => row.status))
    expect(detail.settlements.map(row => row.status)).toEqual(facts.settlements.map(row => row.status))
  })

  it('验证两个父 ID 的真实关系，并返回六类事实、汇总与语义来源目标', () => {
    const detail = buildProjectSupplierWorkbenchRead({
      ...source(),
      query: parseProjectSupplierWorkbenchQuery('project-1', 'supplier-1', { origin: 'demo', includeDemo: 'true' }),
      asOf,
      sourceVersion: 'fixture-v1',
      capabilities: ['project-supplier:read', 'demo:read'],
    })

    expect(detail).toMatchObject({
      dataOrigin: 'demo',
      relation: { id: 'relation-1', status: 'claiming' },
      project: { id: 'project-1', label: '中央项目' },
      supplier: { id: 'supplier-1', label: '中央分供方' },
      summary: {
        contractTotal: '120.00',
        claimedTotal: '70.00',
        invoiceTotal: '60.00',
        taxTotal: '6.00',
        paidTotal: '55.00',
        settlementTotal: '50.00',
        balance: '65.00',
      },
      counts: { contracts: 1, claims: 1, invoices: 1, payments: 1, settlements: 1, files: 1 },
    })
    expect(detail.contracts[0].navigation).toMatchObject({ kind: 'source-record', subject: { id: 'contract-1' }, variant: 'detail', filters: { dataOrigin: 'demo' } })
    expect(detail.claims[0]).toMatchObject({ application: { id: 'claim-1' }, applyAmount: '80.00', approvedAmount: '70.00' })
    expect(detail.claims[0].navigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })
    expect(detail.invoices[0].navigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })
    expect(detail.payments[0].navigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })
    expect(detail.settlements[0].navigation).toEqual({ kind: 'unavailable', reason: 'unverified-target' })
    expect(detail.files[0].navigation).toEqual(detail.contracts[0].navigation)
  })

  it('真实零记录仍返回六个空集合和零值汇总', () => {
    const detail = buildProjectSupplierWorkbenchRead({
      ...source(),
      query: parseProjectSupplierWorkbenchQuery('project-1', 'supplier-empty', { origin: 'demo', includeDemo: 'true' }),
      asOf,
      sourceVersion: 'fixture-v1',
      capabilities: ['project-supplier:read', 'demo:read'],
    })

    expect(detail.counts).toEqual({ contracts: 0, claims: 0, invoices: 0, payments: 0, settlements: 0, files: 0 })
    expect(detail.summary).toEqual({
      contractTotal: '0.00',
      claimedTotal: '0.00',
      invoiceTotal: '0.00',
      taxTotal: '0.00',
      paidTotal: '0.00',
      settlementTotal: '0.00',
      balance: '0.00',
    })
  })

  it('两个父 ID 各自存在但关系错配时返回 relationship-mismatch', () => {
    expect(() => buildProjectSupplierWorkbenchRead({
      ...source(),
      query: parseProjectSupplierWorkbenchQuery('project-2', 'supplier-1', { origin: 'demo', includeDemo: 'true' }),
      asOf,
      sourceVersion: 'fixture-v1',
      capabilities: ['project-supplier:read', 'demo:read'],
    })).toThrowError(ProjectSupplierRepositoryProblem)

    try {
      buildProjectSupplierWorkbenchRead({
        ...source(),
        query: parseProjectSupplierWorkbenchQuery('project-2', 'supplier-1', { origin: 'demo', includeDemo: 'true' }),
        asOf,
        sourceVersion: 'fixture-v1',
        capabilities: ['project-supplier:read', 'demo:read'],
      })
    }
    catch (cause) {
      expect((cause as ProjectSupplierRepositoryProblem).problem.code).toBe('relationship-mismatch')
    }
  })

  it('一个父 ID 存在而另一个不存在时返回 not-found，不误报关系错配', () => {
    try {
      buildProjectSupplierWorkbenchRead({
        ...source(),
        query: parseProjectSupplierWorkbenchQuery('project-1', 'supplier-missing', { origin: 'demo', includeDemo: 'true' }),
        asOf,
        sourceVersion: 'fixture-v1',
        capabilities: ['project-supplier:read', 'demo:read'],
      })
      throw new Error('expected repository problem')
    }
    catch (cause) {
      expect((cause as ProjectSupplierRepositoryProblem).problem.code).toBe('not-found')
    }
  })
})
