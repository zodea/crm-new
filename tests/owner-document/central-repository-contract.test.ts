import type { OwnerCommercialDocumentSource } from '~/lib/owner-document/central-repository'
import { describe, expect, it } from 'vitest'
import {
  buildOwnerCommercialDocumentDetail,
  buildOwnerCommercialDocumentListPage,
  parseOwnerCommercialDocumentDetailQuery,
  parseOwnerCommercialDocumentListQuery,
} from '~/lib/owner-document/central-repository'

const change: OwnerCommercialDocumentSource = {
  dataOrigin: 'real',
  kind: 'owner_change',
  id: 'change-real-323',
  no: 'BG-2026-323',
  name: '首层机电管线变更',
  documentType: 'change_negotiation',
  projectId: 'project-real-323',
  projectName: '瑞航商务中心项目',
  projectPermission: 'allowed',
  customerId: 'customer-real-323',
  customerName: '瑞航置业',
  customerPermission: 'allowed',
  contractId: 'contract-real-323',
  contractNo: 'SG-2026-323',
  contractName: '瑞航商务中心施工合同',
  contractPermission: 'allowed',
  sourceType: 'boq_change_order',
  sourceId: 'change-real-323',
  sourceLocked: true,
  periodNo: '',
  applicationDate: '2026-08-08',
  approvalDate: '2026-08-10',
  status: 'approved',
  statusNote: '甲方已签证',
  amount: 520,
  taxExclusiveAmount: 480,
  appliedTaxExclusiveAmount: 500,
  auditedAmount: null,
  note: '按审定量价执行',
  version: 2,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  lines: [{
    id: 'change-line-real-323',
    boqLineId: 'boq-line-real-323',
    operation: 'qty',
    itemName: '桥架安装',
    unit: 'm',
    contractQty: 100,
    contractUnitPrice: 52,
    autoQty: null,
    reportedQty: null,
    auditedQty: null,
    deltaQty: 10,
    newUnitPrice: null,
    amount: 520,
    auditedAmount: null,
    note: '',
  }],
  files: [{
    id: 'file-change-real-323',
    fileName: '甲方签证单.pdf',
    fileSize: 2048,
    mimeType: 'application/pdf',
    category: '签证依据',
    uploader: '商务经理',
    uploadedAt: '2026-08-08T00:00:00.000Z',
    deletedAt: null,
  }],
}

const report: OwnerCommercialDocumentSource = {
  ...change,
  kind: 'owner_report',
  id: 'report-real-323',
  no: 'BL-2026-08',
  name: '2026 年 8 月月度报量',
  documentType: 'monthly_statement',
  sourceType: 'monthly_statement',
  sourceId: 'report-real-323',
  sourceLocked: true,
  periodNo: '2026-08',
  applicationDate: '2026-08-20',
  approvalDate: null,
  quantityBasis: 'field',
  quantitySourceVersion: 'monthly-quantity-2026-08-v1',
  quantitySourceUpdatedAt: '2026-08-19T08:00:00.000Z',
  operatorName: '周经办',
  submittedAt: '2026-08-20T09:00:00.000Z',
  status: 'audited',
  statusNote: '甲方已审定',
  amount: 5200,
  auditedAmount: 4680,
  updatedAt: '2026-08-22T00:00:00.000Z',
  lines: [{
    id: 'report-line-real-323',
    boqLineId: 'boq-line-real-323',
    operation: null,
    itemName: '桥架安装',
    unit: 'm',
    contractQty: 100,
    contractUnitPrice: 52,
    autoQty: 100,
    reportedQty: 100,
    auditedQty: 90,
    deltaQty: null,
    newUnitPrice: null,
    amount: 5200,
    auditedAmount: 4680,
    note: '甲方核减 10m',
  }],
  files: [],
}

const base = {
  documents: [change, report],
  asOf: '2026-08-25T00:00:00.000Z',
  sourceVersion: 'owner-document-command-1',
  capabilities: ['owner-document:read', 'owner-document:write'],
}

describe('甲方商务单据中央读取契约', () => {
  it('列表按类型隔离，并用稳定 ID 暴露项目、客户、合同与只读详情导航', () => {
    const page = buildOwnerCommercialDocumentListPage({
      ...base,
      query: parseOwnerCommercialDocumentListQuery('owner_change', {
        origin: 'real',
        projectId: 'project-real-323',
        page: 1,
        pageSize: 20,
      }),
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      rowKey: 'real:owner_change:change-real-323',
      id: 'change-real-323',
      kind: 'owner_change',
      amounts: { kind: 'owner_change', boqChange: '520.00', taxInclusive: '520.00', taxExclusive: '480.00', appliedTaxExclusive: '500.00' },
      project: { state: 'resolved', entity: 'project', id: 'project-real-323' },
      customer: { state: 'resolved', entity: 'customer', id: 'customer-real-323' },
      contract: { state: 'resolved', entity: 'contract', id: 'contract-real-323' },
      navigation: {
        kind: 'entity-detail',
        subject: { entity: 'owner-document', id: 'change-real-323' },
        variant: 'change',
        filters: { dataOrigin: 'real' },
      },
    })
    expect(page.summary.origins.real).toEqual({
      count: 1,
      reportedAmount: '520.00',
      auditedAmount: '0.00',
      taxInclusiveAmount: '520.00',
      taxExclusiveAmount: '480.00',
      appliedTaxExclusiveAmount: '500.00',
    })
  })

  it('变洽签详情保留 BOQ 量价、来源锁定、审批摘要、附件与关系下钻', () => {
    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      query: parseOwnerCommercialDocumentDetailQuery('owner_change', 'change-real-323', { origin: 'real' }),
    })

    expect(detail.document).toMatchObject({
      id: 'change-real-323',
      kind: 'owner_change',
      source: { type: 'boq_change_order', id: 'change-real-323', locked: true },
      approvalDate: '2026-08-10',
      amounts: { kind: 'owner_change', boqChange: '520.00', taxInclusive: '520.00', taxExclusive: '480.00', appliedTaxExclusive: '500.00' },
      approval: { status: 'approved', label: '已签证', summary: '甲方已签证' },
    })
    expect(detail.lines).toEqual([
      expect.objectContaining({
        boqLineId: 'boq-line-real-323',
        operation: 'qty',
        contractQty: '100',
        contractUnitPrice: '52.00',
        deltaQty: '10',
        amount: '520.00',
      }),
    ])
    expect(detail.files).toEqual([
      expect.objectContaining({ id: 'file-change-real-323', fileName: '甲方签证单.pdf' }),
    ])
    expect(detail.projectNavigation).toMatchObject({ kind: 'entity-detail', subject: { id: 'project-real-323' } })
    expect(detail.contractNavigation).toMatchObject({ kind: 'entity-detail', subject: { id: 'contract-real-323' } })
    expect(detail.sourceNavigation).toMatchObject({
      kind: 'entity-detail',
      variant: 'owner-document-source',
      view: 'change-real-323',
      filters: { ownerTab: 'changes' },
    })
  })

  it('月度报量详情显式展示申报、审定与核减差额，真实空附件保持可验证', () => {
    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      query: parseOwnerCommercialDocumentDetailQuery('owner_report', 'report-real-323', { origin: 'real' }),
    })

    expect(detail.document).toMatchObject({
      id: 'report-real-323',
      kind: 'owner_report',
      periodNo: '2026-08',
      amounts: { reported: '5200.00', audited: '4680.00', difference: '-520.00' },
      approval: { status: 'audited', label: '已审定', summary: '甲方已审定' },
      quantityEvidence: {
        basis: 'field',
        sourceVersion: 'monthly-quantity-2026-08-v1',
        sourceUpdatedAt: '2026-08-19T08:00:00.000Z',
        operatorName: '周经办',
        submittedAt: '2026-08-20T09:00:00.000Z',
      },
    })
    expect(detail.lines[0]).toMatchObject({
      autoQty: '100',
      reportedQty: '100',
      auditedQty: '90',
      amount: '5200.00',
      auditedAmount: '4680.00',
    })
    expect(detail.files).toEqual([])
    expect(detail.sourceNavigation).toMatchObject({ view: 'report-real-323', filters: { ownerTab: 'settlements' } })
  })

  it('分页、单据类型筛选与汇总均在中央读模型完成，不截断 100 条后记录', () => {
    const documents = Array.from({ length: 205 }, (_, index) => ({
      ...change,
      id: `change-page-${String(index + 1).padStart(3, '0')}`,
      sourceId: `change-page-${String(index + 1).padStart(3, '0')}`,
      documentType: index < 120 ? 'change_negotiation' : 'site_visa',
      updatedAt: `2026-08-${String(index % 25 + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))
    const page = buildOwnerCommercialDocumentListPage({
      ...base,
      documents,
      query: parseOwnerCommercialDocumentListQuery('owner_change', {
        origin: 'real',
        documentType: 'change_negotiation',
        page: 6,
        pageSize: 20,
      }),
    })

    expect(page.pagination).toEqual({ page: 6, pageSize: 20, total: 120 })
    expect(page.items).toHaveLength(20)
    expect(page.summary.documentTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'change_negotiation', count: 120 }),
      expect.objectContaining({ value: 'site_visa', count: 85 }),
    ]))
  })

  it('来源、类型或关系不匹配时拒绝用同 ID 猜测另一条记录', () => {
    expect(() => buildOwnerCommercialDocumentDetail({
      ...base,
      query: parseOwnerCommercialDocumentDetailQuery('owner_change', 'change-real-323', { origin: 'demo', includeDemo: true }),
    })).toThrow('来源与地址不匹配')

    expect(() => buildOwnerCommercialDocumentDetail({
      ...base,
      query: parseOwnerCommercialDocumentDetailQuery('owner_report', 'change-real-323', { origin: 'real' }),
    })).toThrow('类型与地址不匹配')
  })

  it('被禁止的关系只显示禁止态，不泄露项目名称', () => {
    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [{ ...change, projectPermission: 'forbidden' }],
      query: parseOwnerCommercialDocumentDetailQuery('owner_change', 'change-real-323', { origin: 'real' }),
    })

    expect(detail.document.project).toEqual({
      state: 'forbidden',
      entity: 'project',
      id: 'project-real-323',
      label: null,
      reason: 'permission-denied',
    })
    expect(detail.projectNavigation).toEqual({ kind: 'unavailable', reason: 'forbidden' })
  })
})
