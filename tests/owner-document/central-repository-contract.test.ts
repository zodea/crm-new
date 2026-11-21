import type { OwnerCommercialDocumentSource } from '~/lib/owner-document/central-repository'
import { describe, expect, it } from 'vitest'
import {
  buildOwnerCommercialDocumentDetail,
  buildOwnerCommercialDocumentListPage,
  parseOwnerCommercialDocumentDetailQuery,
  parseOwnerCommercialDocumentListQuery,
} from '~/lib/owner-document/central-repository'
import { ownerDocumentListRecordFromCentral } from '~/lib/owner-document/list'

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

const acceptance: OwnerCommercialDocumentSource = {
  ...change,
  kind: 'acceptance',
  id: 'acceptance-real-324',
  no: 'YS-2026-324',
  name: '瑞航商务中心项目竣工验收',
  documentType: 'acceptance_lifecycle',
  sourceType: 'manual',
  sourceId: 'acceptance-real-324',
  sourceLocked: true,
  applicationDate: '2026-07-18',
  status: 'warranty',
  statusNote: '已验收，当前处于保修期',
  amount: 1200000,
  auditedAmount: null,
  updatedAt: '2026-08-24T00:00:00.000Z',
  acceptanceLifecycle: {
    acceptanceOrganization: '建设、监理、施工联合验收组',
    acceptancePerson: '周验收',
    acceptanceDate: '2026-07-18',
    acceptanceConclusion: '验收合格',
    warrantyOwner: '瑞航建设工程有限公司',
    warrantyStartDate: '2026-07-19',
    warrantyEndDate: '2028-07-18',
    warrantyConfirmationOrganization: null,
    warrantyConfirmationDate: null,
    warrantyConfirmationNote: '',
    events: [
      {
        id: 'acceptance-event-submitted-324',
        action: 'submit',
        fromStatus: 'draft',
        toStatus: 'submitted',
        actorId: 'actor-owner-document-324',
        actorName: '周经办',
        occurredAt: '2026-07-17T09:00:00.000Z',
        note: '',
      },
      {
        id: 'acceptance-event-warranty-324',
        action: 'start-warranty',
        fromStatus: 'accepted',
        toStatus: 'warranty',
        actorId: 'actor-owner-document-324',
        actorName: '周经办',
        occurredAt: '2026-07-19T09:00:00.000Z',
        note: '进入保修跟踪',
      },
    ],
  },
  files: [
    {
      id: 'file-acceptance-report-324',
      fileName: '竣工验收报告.pdf',
      fileSize: 4096,
      mimeType: 'application/pdf',
      category: 'acceptance-report',
      uploader: '周经办',
      uploadedAt: '2026-07-18T10:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'file-warranty-confirmation-324',
      fileName: '保修跟踪清单.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      category: 'warranty-confirmation',
      uploader: '周经办',
      uploadedAt: '2026-07-19T10:00:00.000Z',
      deletedAt: null,
    },
  ],
}

const finalSettlement: OwnerCommercialDocumentSource = {
  ...change,
  kind: 'final_settlement',
  id: 'final-settlement-real-325',
  no: 'JS-2026-325',
  name: '瑞航商务中心项目甲方最终结算',
  documentType: 'final_settlement',
  sourceType: 'owner_final_settlement',
  sourceId: 'final-settlement-real-325',
  sourceLocked: true,
  applicationDate: '2026-08-23',
  status: 'submitted',
  statusNote: '已提交甲方结算资料',
  amount: 1280000,
  auditedAmount: null,
  note: '等待甲方审定',
  updatedAt: '2026-08-23T00:00:00.000Z',
  settlementBasis: '施工合同、已确认补充协议及最终结算书',
  settlementDifferenceNote: '审定金额尚未回传',
  finalSettlementEvidence: {
    originalContractAmount: 1200000,
    supplements: [
      {
        id: 'supplement-real-325-draft',
        no: 'BC-2026-DRAFT',
        name: '未提交补充协议',
        status: 'draft',
        amount: 50000,
        date: '2026-08-01',
      },
      {
        id: 'supplement-real-325-approved',
        no: 'BC-2026-01',
        name: '已确认补充协议',
        status: 'approved',
        amount: 80000,
        date: '2026-08-12',
      },
    ],
    receipts: [
      {
        id: 'receipt-real-325-active',
        no: 'SK-2026-01',
        name: '一期工程款',
        status: 'confirmed',
        amount: 900000,
        date: '2026-08-15',
      },
      {
        id: 'receipt-real-325-void',
        no: 'SK-2026-VOID',
        name: '已作废收款',
        status: 'void',
        amount: 100000,
        date: '2026-08-16',
      },
    ],
  },
}

const ownerPenalty = {
  ...change,
  kind: 'owner_penalty',
  id: 'owner-penalty-real-326',
  no: 'FK-2026-326',
  name: '施工进度延误罚扣',
  documentType: 'owner_penalty',
  sourceType: 'owner_penalty',
  sourceId: 'owner-penalty-real-326',
  sourceLocked: true,
  applicationDate: '2026-08-24',
  status: 'submitted',
  statusNote: '已提交甲方罚扣事实',
  amount: 36000,
  auditedAmount: null,
  note: '项目部已核对联系单',
  updatedAt: '2026-08-24T09:00:00.000Z',
  noticeNo: 'LX-2026-326',
  penaltyReason: '施工进度延误',
  appealNote: '已向甲方提交工期顺延说明',
  files: [{
    id: 'file-owner-penalty-real-326',
    fileName: '甲方罚扣联系单.pdf',
    fileSize: 3260,
    mimeType: 'application/pdf',
    category: 'contact-letter',
    uploader: '商务经理',
    uploadedAt: '2026-08-24T09:00:00.000Z',
    deletedAt: null,
  }],
} as unknown as OwnerCommercialDocumentSource

const subcontractChange = {
  ...change,
  kind: 'sub_change',
  id: 'sub-change-real-327',
  no: 'FB-BG-2026-327',
  name: '样板层劳务范围调整',
  documentType: '增项',
  customerId: null,
  customerName: '',
  customerPermission: 'allowed',
  supplierId: 'supplier-real-327',
  supplierName: '中央正式劳务分供方',
  supplierPermission: 'allowed',
  contractId: 'subcontract-real-327',
  contractNo: 'FB-CENTRAL-327',
  contractName: '中央正式劳务分包合同',
  sourceType: 'subcontract_change_order',
  sourceId: 'sub-change-real-327',
  sourceLocked: false,
  applicationDate: '2026-08-26',
  status: 'submitted',
  statusNote: '已提交分包变洽签',
  amount: 38000,
  changedArea: 120,
  actualApprovedPrice: 36000,
  auditedAmount: null,
  note: '按现场确认范围执行',
  updatedAt: '2026-08-26T10:00:00.000Z',
  lines: [],
  files: [{
    id: 'file-sub-change-real-327',
    fileName: '分包变洽签确认单.pdf',
    fileSize: 3270,
    mimeType: 'application/pdf',
    category: '业务附件',
    uploader: '项目商务经理',
    uploadedAt: '2026-08-26T10:00:00.000Z',
    deletedAt: null,
  }],
} as unknown as OwnerCommercialDocumentSource

const base = {
  documents: [change, report],
  asOf: '2026-08-25T00:00:00.000Z',
  sourceVersion: 'owner-document-command-1',
  capabilities: ['owner-document:read', 'owner-document:write'],
}

describe('甲方商务单据中央读取契约', () => {
  it.each([null, 0])('甲方报量列表保留审定金额和差额的 %s', (auditedAmount) => {
    const page = buildOwnerCommercialDocumentListPage({
      ...base,
      documents: [{ ...report, amount: 0, auditedAmount }],
      query: parseOwnerCommercialDocumentListQuery('owner_report', {}),
    })

    expect(page.items.map(ownerDocumentListRecordFromCentral)).toEqual([
      expect.objectContaining({ secondaryAmount: auditedAmount, tertiaryAmount: auditedAmount }),
    ])
  })

  it('中央多选在分页前取并集，组合类型不缩减候选集', () => {
    const documents = [change, { ...change, id: 'second', documentType: 'site_visa', status: 'submitted' }, { ...change, id: 'third', status: 'draft' }]
    const query = parseOwnerCommercialDocumentListQuery('owner_change', { status: '["approved","submitted"]', documentType: '["change_negotiation","site_visa"]' })
    const page = buildOwnerCommercialDocumentListPage({ ...base, documents, query })
    expect(page.pagination.total).toBe(2)
    expect(page.summary.statuses.map(item => item.value)).toContain('draft')
    expect(buildOwnerCommercialDocumentListPage({ ...base, documents, query: { ...query, documentType: ['site_visa'] } }).items.map(item => item.documentType)).toEqual(['site_visa'])
    expect(() => parseOwnerCommercialDocumentListQuery('owner_change', { status: '[1]' })).toThrow('筛选无效')
  })
  it('分包变洽签按稳定项目、分供方与分包合同关系输出专属只读事实', () => {
    const page = buildOwnerCommercialDocumentListPage({
      ...base,
      documents: [subcontractChange],
      query: parseOwnerCommercialDocumentListQuery('sub_change', {
        origin: 'real',
        projectId: 'project-real-323',
        contractId: 'subcontract-real-327',
        page: 1,
        pageSize: 20,
      }),
    })

    expect(page.items).toEqual([
      expect.objectContaining({
        rowKey: 'real:sub_change:sub-change-real-327',
        kind: 'sub_change',
        amounts: {
          kind: 'sub_change',
          approved: '38000.00',
          changedArea: '120',
          actualApproved: '36000.00',
        },
        project: expect.objectContaining({ state: 'resolved', entity: 'project', id: 'project-real-323' }),
        supplier: expect.objectContaining({ state: 'resolved', entity: 'supplier', id: 'supplier-real-327' }),
        contract: expect.objectContaining({ state: 'resolved', entity: 'contract', id: 'subcontract-real-327' }),
        attachmentCount: 1,
        navigation: expect.objectContaining({
          subject: expect.objectContaining({ entity: 'subcontract-document', id: 'sub-change-real-327' }),
          variant: 'change',
        }),
      }),
    ])
    expect(page.summary.origins.real).toMatchObject({
      reportedAmount: '0.00',
      taxInclusiveAmount: '0.00',
      subcontractApprovedAmount: '38000.00',
      subcontractActualApproved: { value: '36000.00', status: 'complete' },
    })

    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [subcontractChange],
      query: parseOwnerCommercialDocumentDetailQuery('sub_change', 'sub-change-real-327', { origin: 'real' }),
    })

    expect(detail.document).toMatchObject({
      id: 'sub-change-real-327',
      kind: 'sub_change',
      applicationDate: '2026-08-26',
      amounts: {
        kind: 'sub_change',
        approved: '38000.00',
        changedArea: '120',
        actualApproved: '36000.00',
      },
      supplier: { state: 'resolved', entity: 'supplier', id: 'supplier-real-327' },
      contract: { state: 'resolved', entity: 'contract', id: 'subcontract-real-327' },
    })
    expect(detail.supplierNavigation).toMatchObject({ kind: 'entity-detail', subject: { id: 'supplier-real-327' } })
    expect(detail.contractNavigation).toMatchObject({
      kind: 'entity-detail',
      filters: { dataOrigin: 'real', contractKind: '分包' },
    })
    expect(detail.sourceNavigation).toMatchObject({
      kind: 'entity-detail',
      variant: 'subcontract-document-source',
      view: 'sub-change-real-327',
      filters: { subcontractTab: 'changes' },
    })
    expect(detail.files).toEqual([
      expect.objectContaining({ id: 'file-sub-change-real-327', fileName: '分包变洽签确认单.pdf' }),
    ])
  })

  it('分包变洽签详情不在来源错配时回退到同 ID 的其他来源', () => {
    expect(() => buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [subcontractChange],
      query: parseOwnerCommercialDocumentDetailQuery('sub_change', 'sub-change-real-327', { origin: 'demo', includeDemo: true }),
    })).toThrowError(/来源与地址不匹配/)
  })

  it('分包变洽签按分供方稳定 ID 收窄，并可搜索类型与分供方名称', () => {
    const otherSupplier = {
      ...subcontractChange,
      id: 'sub-change-other-supplier-327',
      supplierId: 'supplier-other-327',
      supplierName: '另一家分供方',
    }
    const documents = [subcontractChange, otherSupplier]
    const list = (input: Record<string, unknown>) => buildOwnerCommercialDocumentListPage({
      ...base,
      documents,
      query: parseOwnerCommercialDocumentListQuery('sub_change', input),
    })

    expect(list({ supplierId: 'supplier-real-327' }).items.map(row => row.id))
      .toEqual(['sub-change-real-327'])
    expect(list({ supplierId: 'supplier-missing-327' }).items).toEqual([])
    expect(list({ search: '增项' }).items.map(row => row.id)).toContain('sub-change-real-327')
    expect(list({ search: '中央正式劳务分供方' }).items.map(row => row.id)).toContain('sub-change-real-327')
  })

  it('分包变洽签实际审定价保持 null 与零值的业务差异', () => {
    const page = buildOwnerCommercialDocumentListPage({
      ...base,
      documents: [
        { ...subcontractChange, id: 'sub-change-null-327', actualApprovedPrice: null },
        { ...subcontractChange, id: 'sub-change-zero-327', actualApprovedPrice: 0 },
      ],
      query: parseOwnerCommercialDocumentListQuery('sub_change', {}),
    })

    expect(page.items.map(row => row.amounts)).toEqual([
      expect.objectContaining({ actualApproved: null }),
      expect.objectContaining({ actualApproved: '0.00' }),
    ])
    expect(page.items.map(ownerDocumentListRecordFromCentral).map(row => row.secondaryAmount))
      .toEqual([null, 0])
    expect(page.summary.origins.real.subcontractActualApproved).toEqual({
      value: '0.00',
      status: 'partial',
    })

    const missing = buildOwnerCommercialDocumentListPage({
      ...base,
      documents: [
        { ...subcontractChange, id: 'sub-change-null-a-327', actualApprovedPrice: null },
        { ...subcontractChange, id: 'sub-change-null-b-327', actualApprovedPrice: null },
      ],
      query: parseOwnerCommercialDocumentListQuery('sub_change', {}),
    })
    expect(missing.summary.origins.real.subcontractActualApproved).toEqual({
      value: null,
      status: 'missing',
    })
  })

  it('甲方罚扣按专属事实读取，并可按联系单搜索后返回施工合同来源', () => {
    const page = buildOwnerCommercialDocumentListPage({
      ...base,
      documents: [ownerPenalty],
      query: parseOwnerCommercialDocumentListQuery('owner_penalty', {
        origin: 'real',
        search: 'LX-2026-326',
        page: 1,
        pageSize: 20,
      }),
    })

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'owner-penalty-real-326',
        kind: 'owner_penalty',
        name: '施工进度延误罚扣',
        amounts: { kind: 'owner_penalty', amount: '36000.00' },
        attachmentCount: 1,
        navigation: expect.objectContaining({ variant: 'penalty' }),
      }),
    ])

    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [ownerPenalty],
      query: parseOwnerCommercialDocumentDetailQuery('owner_penalty', ownerPenalty.id, { origin: 'real' }),
    })

    expect(detail.ownerPenaltyFacts).toEqual({
      noticeNo: 'LX-2026-326',
      penaltyDate: '2026-08-24',
      reason: '施工进度延误',
      appealNote: '已向甲方提交工期顺延说明',
    })
    expect(detail.sourceNavigation).toMatchObject({
      kind: 'entity-detail',
      variant: 'owner-document-source',
      view: 'owner-penalty-real-326',
      filters: { ownerTab: 'settlements' },
    })
    expect(detail.files).toEqual([
      expect.objectContaining({ id: 'file-owner-penalty-real-326', category: 'contact-letter' }),
    ])
  })

  it('最终结算只从真实合同、补充协议与收款事实聚合金额，并保留未知审定额', () => {
    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [finalSettlement],
      query: parseOwnerCommercialDocumentDetailQuery('final_settlement', finalSettlement.id, { origin: 'real' }),
    })

    expect(detail.document).toMatchObject({
      id: 'final-settlement-real-325',
      kind: 'final_settlement',
      source: { type: 'owner_final_settlement', id: 'final-settlement-real-325', locked: true },
      amounts: {
        kind: 'final_settlement',
        declared: '1280000.00',
        audited: null,
        changedContract: '1280000.00',
        cumulativeReceipts: '900000.00',
        receiptDifference: '380000.00',
      },
    })
    expect(detail.finalSettlementEvidence).toMatchObject({
      basis: '施工合同、已确认补充协议及最终结算书',
      differenceNote: '审定金额尚未回传',
    })
    expect(detail.finalSettlementEvidence?.sources).toEqual([
      expect.objectContaining({
        kind: 'contract-supplement',
        id: 'supplement-real-325-approved',
        amount: '80000.00',
        navigation: expect.objectContaining({ variant: 'supplement', view: 'supplement-real-325-approved' }),
      }),
      expect.objectContaining({
        kind: 'receipt',
        id: 'receipt-real-325-active',
        amount: '900000.00',
        navigation: expect.objectContaining({ variant: 'detail', filters: expect.objectContaining({ customerId: 'customer-real-323' }) }),
      }),
    ])
    expect(detail.sourceNavigation).toMatchObject({
      kind: 'entity-detail',
      variant: 'owner-document-source',
      view: 'final-settlement-real-325',
      filters: { ownerTab: 'settlements' },
    })
  })

  it('最终结算证据源缺失时不把未知金额伪装成零', () => {
    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [{
        ...finalSettlement,
        finalSettlementEvidence: {
          originalContractAmount: null,
          supplements: null,
          receipts: null,
        },
      }],
      query: parseOwnerCommercialDocumentDetailQuery('final_settlement', finalSettlement.id, { origin: 'real' }),
    })

    expect(detail.document.amounts).toEqual({
      kind: 'final_settlement',
      declared: '1280000.00',
      audited: null,
      changedContract: null,
      cumulativeReceipts: null,
      receiptDifference: null,
    })
    expect(detail.finalSettlementEvidence?.sources).toBeNull()
  })

  it('验收与保修按同一稳定 ID 生成双视图，并只暴露各自字段和附件', () => {
    const documents = [acceptance]
    const acceptanceDetail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents,
      query: parseOwnerCommercialDocumentDetailQuery('acceptance', acceptance.id, {
        origin: 'real',
        variant: 'acceptance',
      }),
    })
    const warrantyDetail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents,
      query: parseOwnerCommercialDocumentDetailQuery('acceptance', acceptance.id, {
        origin: 'real',
        variant: 'warranty',
      }),
    })

    expect(acceptanceDetail.document.id).toBe(warrantyDetail.document.id)
    expect(acceptanceDetail.acceptanceView).toEqual({
      variant: 'acceptance',
      organization: '建设、监理、施工联合验收组',
      person: '周验收',
      date: '2026-07-18',
      conclusion: '验收合格',
    })
    expect(acceptanceDetail.files.map(file => file.id)).toEqual(['file-acceptance-report-324'])
    expect(warrantyDetail.acceptanceView).toEqual({
      variant: 'warranty',
      owner: '瑞航建设工程有限公司',
      startDate: '2026-07-19',
      endDate: '2028-07-18',
      confirmationOrganization: null,
      confirmationDate: null,
      confirmationNote: '',
    })
    expect(warrantyDetail.files.map(file => file.id)).toEqual(['file-warranty-confirmation-324'])
    expect(warrantyDetail.lifecycleEvents).toHaveLength(2)
    expect(warrantyDetail.documentNavigation).toMatchObject({
      kind: 'entity-detail',
      subject: { id: acceptance.id },
      variant: 'warranty',
    })
    expect(warrantyDetail.sourceNavigation).toMatchObject({
      kind: 'entity-detail',
      variant: 'owner-document-source',
      view: acceptance.id,
      filters: { ownerTab: 'acceptance' },
    })
  })

  it('验收与保修列表使用同一 canonical 行，但输出各自专属列', () => {
    const documents = [acceptance]
    const acceptancePage = buildOwnerCommercialDocumentListPage({
      ...base,
      documents,
      query: parseOwnerCommercialDocumentListQuery('acceptance', {
        origin: 'real',
        variant: 'acceptance',
        page: 1,
        pageSize: 20,
      }),
    })
    const warrantyPage = buildOwnerCommercialDocumentListPage({
      ...base,
      documents,
      query: parseOwnerCommercialDocumentListQuery('acceptance', {
        origin: 'real',
        variant: 'warranty',
        page: 1,
        pageSize: 20,
      }),
    })

    expect(acceptancePage.items[0]).toMatchObject({
      id: acceptance.id,
      acceptanceView: {
        variant: 'acceptance',
        organization: '建设、监理、施工联合验收组',
        date: '2026-07-18',
      },
      navigation: { variant: 'acceptance' },
    })
    expect(warrantyPage.items[0]).toMatchObject({
      id: acceptance.id,
      acceptanceView: {
        variant: 'warranty',
        owner: '瑞航建设工程有限公司',
        endDate: '2028-07-18',
      },
      navigation: { variant: 'warranty' },
    })
  })

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
      subcontractApprovedAmount: '0.00',
      subcontractActualApproved: { value: null, status: 'missing' },
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

    expect(page.pagination).toEqual({ requestedPage: 6, page: 6, pageSize: 20, total: 120 })
    expect(page.items).toHaveLength(20)
    expect(page.summary.documentTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'change_negotiation', count: 120 }),
      expect.objectContaining({ value: 'site_visa', count: 85 }),
    ]))
  })

  it.each([
    { case: '{ ...base, query: parseOwnerCommercialDocumentDetailQuery(\'owner_change\', \'change-real-323\', { origin: \'demo\', includeDemo: t', input: {
      ...base,
      query: parseOwnerCommercialDocumentDetailQuery('owner_change', 'change-real-323', { origin: 'demo', includeDemo: true }),
    }, expected: '来源与地址不匹配' },
    { case: '{ ...base, query: parseOwnerCommercialDocumentDetailQuery(\'owner_report\', \'change-real-323\', { origin: \'real\' }), }', input: {
      ...base,
      query: parseOwnerCommercialDocumentDetailQuery('owner_report', 'change-real-323', { origin: 'real' }),
    }, expected: '类型与地址不匹配' },
  ])('来源、类型或关系不匹配时拒绝用同 ID 猜测另一条记录 / buildOwnerCommercialDocumentDetail：$case', ({ input, expected }) => {
    expect(() => buildOwnerCommercialDocumentDetail(input)).toThrow(expected)
  })

  it('被禁止的关系只显示禁止态，不泄露项目身份或名称', () => {
    const detail = buildOwnerCommercialDocumentDetail({
      ...base,
      documents: [{ ...change, projectPermission: 'forbidden' }],
      query: parseOwnerCommercialDocumentDetailQuery('owner_change', 'change-real-323', { origin: 'real' }),
    })

    expect(detail.document.project).toEqual({
      state: 'forbidden',
      entity: 'project',
      id: null,
      label: null,
      reason: 'permission-denied',
    })
    expect(detail.projectNavigation).toEqual({ kind: 'unavailable', reason: 'forbidden' })
    expect(JSON.stringify(detail.document.project)).not.toContain('project-real-323')
  })

  it('受限主档身份不经筛选项、关联名搜索或外键筛选重新泄漏，单据独立金额保留', () => {
    const input = { ...base, documents: [{ ...change, projectPermission: 'forbidden' as const, contractPermission: 'forbidden' as const }] }
    const page = buildOwnerCommercialDocumentListPage({ ...input, query: parseOwnerCommercialDocumentListQuery('owner_change', {}) })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]!.project.id).toBeNull()
    expect(page.items[0]!.contract.id).toBeNull()
    expect(page.summary.projects).toEqual([])
    expect(page.summary.contracts).toEqual([])
    expect(JSON.stringify(page)).not.toContain('project-real-323')
    expect(JSON.stringify(page)).not.toContain('contract-real-323')
    expect(page.summary.origins.real.taxInclusiveAmount).toBe('520.00')
    for (const query of [{ search: '瑞航商务中心' }, { projectId: 'project-real-323' }, { contractId: 'contract-real-323' }])
      expect(buildOwnerCommercialDocumentListPage({ ...input, query: parseOwnerCommercialDocumentListQuery('owner_change', query) }).items).toEqual([])
  })
})
