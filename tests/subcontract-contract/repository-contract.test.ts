import type {
  SubcontractContractDetailSource,
  SubcontractContractFactSources,
} from '../../app/lib/subcontract-contract/repository'
import { describe, expect, it } from 'vitest'
import {
  buildSubcontractContractDetail,
  buildSubcontractContractListPage,
  parseSubcontractContractListQuery,
} from '../../app/lib/subcontract-contract/repository'

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
  changes: [],
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
      capabilities: ['subcontract-contract:read', 'subcontract-contract:write'],
    })

    expect(detail.sections.payments.applications).toHaveLength(1)
    expect(detail.sections.payments.records).toHaveLength(1)
    expect(detail.sections.settlements.progress).toHaveLength(1)
    expect(detail.sections.settlements.completion).toHaveLength(1)
    expect(detail.sections.materialUses).toEqual({
      currentWarehouse: [],
      legacy: [],
      emptyReason: 'missing-relation',
    })
  })
})
