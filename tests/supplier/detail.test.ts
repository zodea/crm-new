import { describe, expect, it } from 'vitest'
import credentialsSeed from '~/lib/db/seed/supplier_credentials.json'
import suppliersSeed from '~/lib/db/seed/suppliers.json'
import {
  buildSupplierProjectSummaries,
  buildSupplierReadonlySummary,
  resolveCredentialStatus,
} from '~/lib/supplier/detail'

const contracts = [
  {
    id: 'c1',
    no: 'C-1',
    name: '钢筋采购',
    kind: '材采',
    projectId: 'p1',
    projectName: '项目甲',
    amount: 1000,
    changed: 0,
    settled: 0,
    paid: 600,
    signDate: '2026-01-01',
    status: '履约中',
  },
  {
    id: 'c2',
    no: 'C-2',
    name: '防水分包',
    kind: '分包',
    projectId: 'p2',
    projectName: '项目乙',
    amount: 500,
    changed: 0,
    settled: 500,
    paid: 500,
    signDate: '2026-02-01',
    status: '已结清',
  },
]

const payments = [
  {
    id: 'pay-p1',
    applicationNo: 'P-1',
    name: '项目甲付款',
    projectId: 'p1',
    projectName: '项目甲',
    amount: 600,
    approvedAmount: 600,
    paidAmount: 600,
    actualPayment: 600,
    approvalStatus: '已通过',
    paymentStatus: '已付款',
    createdAt: '2026-03-01',
  },
  {
    id: 'pay-p2',
    applicationNo: 'P-2',
    name: '项目乙付款',
    projectId: 'p2',
    projectName: '项目乙',
    amount: 500,
    approvedAmount: 500,
    paidAmount: 500,
    actualPayment: 500,
    approvalStatus: '已通过',
    paymentStatus: '已付款',
    createdAt: '2026-03-02',
  },
]

describe('分供方详情纯聚合', () => {
  it('合作项目只取真实 ProjectSupplier 关系，并实时汇总该关系下的合同额/实际付款/应付', () => {
    const projects = buildSupplierProjectSummaries([
      {
        id: 'ps1',
        projectId: 'p1',
        projectName: '项目甲',
        projectStatus: '在建',
        relationshipStatus: 'contracted',
      },
    ], contracts, payments)

    expect(projects).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        contractCount: 1,
        contractTotal: 1000,
        paidTotal: 600,
        payableBalance: 400,
        settlementStatus: '履约中',
      }),
    ])
  })

  it('项目结算态由项目级余额派生，不受多份合同的查询顺序影响', () => {
    const mixedContracts = [
      contracts[0]!,
      { ...contracts[0]!, id: 'c3', amount: 200, paid: 200, status: '已结清' },
    ]
    const partialPayment = [{ ...payments[0]!, actualPayment: 700 }]

    const relations = [{
      id: 'ps1',
      projectId: 'p1',
      projectName: '项目甲',
      projectStatus: '在建',
      relationshipStatus: 'contracted',
    }]
    const forward = buildSupplierProjectSummaries(relations, mixedContracts, partialPayment)
    const reversed = buildSupplierProjectSummaries(relations, [...mixedContracts].reverse(), partialPayment)
    expect(forward[0]).toMatchObject({ payableBalance: 500, settlementStatus: '履约中' })
    expect(reversed[0]).toMatchObject({ payableBalance: 500, settlementStatus: '履约中' })
  })

  it('只读总览分别汇总合同、审批请款、已归档收票，并以合同已付计算应付', () => {
    const projects = buildSupplierProjectSummaries([{
      id: 'ps1',
      projectId: 'p1',
      projectName: '项目甲',
      projectStatus: '在建',
      relationshipStatus: 'contracted',
    }], contracts)
    const summary = buildSupplierReadonlySummary(projects, contracts, [{
      id: 'pay1',
      applicationNo: 'P-1',
      name: '请款',
      projectId: 'p1',
      projectName: '项目甲',
      amount: 400,
      approvedAmount: 350.55,
      paidAmount: 300,
      actualPayment: 300,
      approvalStatus: '已通过',
      paymentStatus: '部分付款',
      createdAt: '2026-03-01',
    }], [{
      id: 'inv1',
      invoiceNumber: 'NO-1',
      invoiceType: '专票',
      invoiceDate: '2026-03-02',
      projectId: 'p1',
      projectName: '项目甲',
      totalAmount: 678.04,
      taxAmount: 55.98,
    }])

    expect(summary).toEqual({
      projectCount: 1,
      contractCount: 2,
      contractTotal: 1500,
      settledTotal: 500,
      claimedTotal: 350.55,
      invoiceTotal: 678.04,
      invoiceTaxTotal: 55.98,
      paidTotal: 300,
      payableBalance: 1200,
    })
  })

  it('资料齐全只进入待核验，绝不自动产生人工合格', () => {
    expect(resolveCredentialStatus(['营业执照', '法人身份证'])).toBe('incomplete')
    expect(resolveCredentialStatus(['营业执照', '法人身份证', '银行开户许可证', '其他'])).toBe('reviewing')
  })

  it('旧演示种子的自动合格只可重算成自动态', () => {
    for (const supplier of suppliersSeed) {
      const categories = credentialsSeed
        .filter(credential => credential.supplier_id === supplier.id)
        .map(credential => credential.category)
      expect(['incomplete', 'reviewing']).toContain(resolveCredentialStatus(categories))
    }
  })
})
