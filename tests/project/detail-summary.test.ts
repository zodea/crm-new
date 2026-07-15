import { describe, expect, it } from 'vitest'
import {
  calculateProjectInvoiceSummary,
  calculateProjectOperationSummary,
} from '~/lib/project/detail-summary'
import { summarizeProjectFinance } from '~/lib/project/finance'

describe('项目详情经营数据（DATABASE.md §4.1）', () => {
  it('按项目子表聚合合同、收付款、往来款与可用资金余额', () => {
    expect(calculateProjectOperationSummary({
      projectId: 'p1',
      constructionContracts: [
        { projectId: 'p1', amount: 1000 },
        { projectId: 'p2', amount: 9999 },
      ],
      supplementAgreements: [
        { projectId: 'p1', amount: 100 },
      ],
      ownerChangeOrders: [
        { projectId: 'p1', taxIncAmount: 50 },
      ],
      receiptRegistrations: [
        { projectId: 'p1', amount: 800 },
      ],
      paymentApplications: [
        { projectId: 'p1', actualPayment: 300 },
      ],
      currentReceipts: [
        { projectId: 'p1', amount: 40 },
      ],
      currentPayments: [
        { projectId: 'p1', amount: 20 },
      ],
      managementFee: 10,
    })).toEqual({
      mainContractAmount: 1000,
      supplementAmount: 100,
      ownerChangeAmount: 50,
      changedContractAmount: 1150,
      projectReceipt: 800,
      paymentAmount: 300,
      currentReceipt: 40,
      currentPayment: 20,
      managementFee: 10,
      availableBalance: 510,
    })
  })

  it('空表与非法金额均归零，不产生 NaN', () => {
    expect(calculateProjectOperationSummary({
      projectId: 'p1',
      constructionContracts: [{ projectId: 'p1', amount: Number.NaN }],
    })).toEqual({
      mainContractAmount: 0,
      supplementAmount: 0,
      ownerChangeAmount: 0,
      changedContractAmount: 0,
      projectReceipt: 0,
      paymentAmount: 0,
      currentReceipt: 0,
      currentPayment: 0,
      managementFee: 0,
      availableBalance: 0,
    })
  })
})

describe('项目详情票据信息（DATABASE.md §4.2 / ADR-0001）', () => {
  it('进项只累计该项目已归档发票，并返回归档张数', () => {
    expect(calculateProjectInvoiceSummary({
      projectId: 'p1',
      invoiceApplications: [
        { projectId: 'p1', amount: 1000, taxAmount: 90 },
        { projectId: 'p2', amount: 9000, taxAmount: 900 },
      ],
      invoices: [
        { projectId: 'p1', amount: 400, taxAmount: 40, accountStatus: 'archived' },
        { projectId: 'p1', amount: 300, taxAmount: 30, accountStatus: 'none' },
        { projectId: 'p2', amount: 800, taxAmount: 80, accountStatus: 'archived' },
      ],
    })).toEqual({
      outputAmount: 1000,
      outputTax: 90,
      inputAmount: 400,
      inputTax: 40,
      vat: 50,
      taxBurdenRate: 0.05,
      archivedCount: 1,
    })
  })

  it('销项票额为零时税负率归零', () => {
    expect(calculateProjectInvoiceSummary({ projectId: 'p1' }).taxBurdenRate).toBe(0)
  })
})

describe('项目列表金额列与详情聚合同源', () => {
  it('优先使用详情聚合的累计收入与主合同金额', () => {
    expect(summarizeProjectFinance(
      { contractAmount: 3238.84 },
      { income: 25367027, mainContractAmount: 32388422 },
    )).toEqual({ income: 25367027, budget: 32388422 })
  })
})
