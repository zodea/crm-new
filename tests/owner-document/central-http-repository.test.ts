import { describe, expect, it, vi } from 'vitest'
import {
  createHttpOwnerCommercialDocumentCommandRepository,
  createHttpOwnerCommercialDocumentReadRepository,
} from '~/lib/owner-document/central-http-repository'
import {
  buildOwnerCommercialDocumentDetail,
  parseOwnerCommercialDocumentDetailQuery,
  parseOwnerCommercialDocumentListQuery,
} from '~/lib/owner-document/central-repository'

const project = { state: 'resolved', entity: 'project', id: 'project-323', label: '中央项目', no: null }
const customer = { state: 'resolved', entity: 'customer', id: 'customer-323', label: '中央客户', no: null }
const contract = { state: 'resolved', entity: 'contract', id: 'contract-323', label: '中央施工合同', no: 'SG-323' }
function navigation(subject: typeof project | typeof customer | typeof contract) {
  return {
    kind: 'entity-detail',
    subject,
    variant: 'detail',
    view: null,
    filters: { dataOrigin: 'real' },
  }
}

function validListPage(itemOverrides: Record<string, unknown> = {}) {
  return {
    items: [{
      rowKey: 'real:owner_change:change-323',
      dataOrigin: 'real',
      kind: 'owner_change',
      id: 'change-323',
      no: 'BG-323',
      name: '中央变洽签',
      documentType: 'change_negotiation',
      periodNo: '',
      applicationDate: '2026-08-25',
      status: 'submitted',
      statusLabel: '已上报',
      amounts: { kind: 'owner_change', boqChange: '320.00', taxInclusive: '323.00', taxExclusive: '300.00', appliedTaxExclusive: '301.00' },
      project,
      projectNavigation: navigation(project),
      customer,
      customerNavigation: navigation(customer),
      contract,
      contractNavigation: navigation(contract),
      navigation: { kind: 'entity-detail', subject: { state: 'resolved', entity: 'owner-document', id: 'change-323', label: '中央变洽签', no: 'BG-323' }, variant: 'owner-change', view: null, filters: { dataOrigin: 'real' } },
      acceptanceView: null,
      ownerPenaltyFacts: null,
      updatedAt: '2026-08-25T00:00:00.000Z',
      ...itemOverrides,
    }],
    pagination: { page: 1, pageSize: 20, total: 1 },
    summary: {
      projects: [],
      contracts: [],
      statuses: [],
      documentTypes: [],
      origins: {
        real: { count: 1, reportedAmount: '0.00', auditedAmount: '0.00', taxInclusiveAmount: '323.00', taxExclusiveAmount: '300.00', appliedTaxExclusiveAmount: '301.00' },
        demo: { count: 0, reportedAmount: '0.00', auditedAmount: '0.00', taxInclusiveAmount: '0.00', taxExclusiveAmount: '0.00', appliedTaxExclusiveAmount: '0.00' },
      },
    },
    empty: null,
    asOf: '2026-08-25T00:00:00.000Z',
    sourceVersion: 'v1',
    capabilities: ['owner-document:read'],
  }
}

function validForm(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'owner_change',
    id: 'change-323',
    draft: {
      id: 'change-323',
      no: 'BG-323',
      name: '中央变洽签',
      projectId: 'project-323',
      contractId: 'contract-323',
      documentType: 'change_negotiation',
      applicationDate: '2026-08-25',
      status: 'draft',
      statusNote: '',
      sourceType: 'boq_change_order',
      sourceId: 'change-323',
      sourceLocked: false,
      approvalDate: null,
      approvedTaxInclusiveAmount: 323,
      approvedTaxExclusiveAmount: 300,
      appliedTaxExclusiveAmount: 301,
      totalAmount: 320,
      reason: '现场变更',
      note: '',
      lines: [{
        id: 'line-323',
        operation: 'qty',
        boqLineId: 'boq-323',
        itemName: '桥架安装',
        unit: 'm',
        contractQty: 100,
        contractUnitPrice: 52,
        qty: 100,
        unitPrice: 52,
        deltaQty: 1,
        newUnitPrice: null,
        amount: 52,
        note: '',
      }],
    },
    attachments: [{
      id: 'file-323',
      ownerType: 'owner_change_order',
      ownerId: 'change-323',
      fileName: '变更依据.pdf',
      filePath: '',
      fileSize: 323,
      mimeType: 'application/pdf',
      category: '变更依据',
      uploader: '周经办',
      uploadedAt: '2026-08-25T00:00:00.000Z',
      deletedAt: null,
    }],
    version: '1',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  }
}

function validPenaltyDetail() {
  return buildOwnerCommercialDocumentDetail({
    documents: [{
      dataOrigin: 'real',
      kind: 'owner_penalty',
      id: 'owner-penalty-326',
      no: 'FK-2026-326',
      name: '施工进度延误',
      documentType: 'owner_penalty',
      projectId: 'project-323',
      projectName: '中央项目',
      projectPermission: 'allowed',
      customerId: 'customer-323',
      customerName: '中央客户',
      customerPermission: 'allowed',
      contractId: 'contract-323',
      contractNo: 'SG-323',
      contractName: '中央施工合同',
      contractPermission: 'allowed',
      sourceType: 'owner_penalty',
      sourceId: 'owner-penalty-326',
      sourceLocked: true,
      periodNo: '',
      applicationDate: '2026-08-26',
      status: 'submitted',
      statusNote: '已提交',
      amount: 36000,
      auditedAmount: null,
      note: '项目部已核对',
      version: 1,
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
      lines: [],
      files: [{
        id: 'penalty-file-326',
        fileName: '甲方联系单.pdf',
        fileSize: 326,
        mimeType: 'application/pdf',
        category: 'contact-letter',
        uploader: '周经办',
        uploadedAt: '2026-08-26T00:00:00.000Z',
        deletedAt: null,
      }],
      noticeNo: 'LX-2026-326',
      penaltyReason: '施工进度延误',
      appealNote: '已提交工期顺延说明',
    }],
    query: parseOwnerCommercialDocumentDetailQuery('owner_penalty', 'owner-penalty-326', { origin: 'real' }),
    asOf: '2026-08-26T00:00:00.000Z',
    sourceVersion: 'penalty-v1',
    capabilities: ['owner-document:read'],
  })
}

function validPenaltyForm(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'owner_penalty',
    id: 'owner-penalty-326',
    draft: {
      id: 'owner-penalty-326',
      no: 'FK-2026-326',
      name: '',
      projectId: 'project-323',
      contractId: 'contract-323',
      noticeNo: 'LX-2026-326',
      amount: 36000,
      penaltyDate: '2026-08-26',
      reason: '施工进度延误',
      appealNote: '已提交工期顺延说明',
      status: 'submitted',
      statusNote: '已提交',
      sourceType: 'owner_penalty',
      sourceId: 'owner-penalty-326',
      sourceLocked: true,
      note: '项目部已核对',
      lines: [],
    },
    attachments: [{
      id: 'penalty-file-326',
      ownerType: 'owner_penalty',
      ownerId: 'owner-penalty-326',
      fileName: '甲方联系单.pdf',
      filePath: '',
      fileSize: 326,
      mimeType: 'application/pdf',
      category: 'contact-letter',
      uploader: '周经办',
      uploadedAt: '2026-08-26T00:00:00.000Z',
      deletedAt: null,
    }],
    version: '1',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...overrides,
  }
}

describe('甲方商务单据中央 HTTP Repository', () => {
  it('只按类型与稳定 ID 访问中央读取地址', async () => {
    const fetcher = vi.fn().mockResolvedValue(validListPage())
    const repository = createHttpOwnerCommercialDocumentReadRepository({ fetcher })
    const query = parseOwnerCommercialDocumentListQuery('owner_change', { origin: 'real', pageSize: 20 })

    await repository.list(query)
    expect(fetcher).toHaveBeenCalledWith('/api/read/owner-documents/owner_change', { query: { ...query } })
  })

  it('正式保存只向命令端点发送显式命令信封', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      id: 'change-323',
      commandId: 'command-323',
      version: '2',
      updatedAt: '2026-08-25T00:00:00.000Z',
      attachmentIds: [],
      deleted: false,
    })
    const repository = createHttpOwnerCommercialDocumentCommandRepository({ fetcher })
    const command = {
      workspaceId: 'workspace-323',
      actorId: 'actor-323',
      requiredCapability: 'owner-document:write' as const,
      commandId: 'command-323',
      action: 'save' as const,
      kind: 'owner_change' as const,
      id: 'change-323',
      baseVersion: '1',
      draft: { id: 'change-323' },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }

    await repository.execute(command)
    expect(fetcher).toHaveBeenCalledWith('/api/commands/owner-documents', { method: 'POST', body: command })
  })

  it('把远端 forbidden Problem 保留为可区分的仓储错误', async () => {
    const fetcher = vi.fn().mockRejectedValue({
      data: { code: 'forbidden', message: '无查看权限', retryable: false, fieldErrors: {}, traceId: 'trace-323' },
    })
    const repository = createHttpOwnerCommercialDocumentReadRepository({ fetcher })

    await expect(repository.list(parseOwnerCommercialDocumentListQuery('owner_report', {})))
      .rejects
      .toMatchObject({ problem: { code: 'forbidden', traceId: 'trace-323' } })
  })

  it('解码甲方罚扣的专属事实、来源返回与联系单附件', async () => {
    const detail = validPenaltyDetail()
    const readRepository = createHttpOwnerCommercialDocumentReadRepository({
      fetcher: vi.fn().mockResolvedValue(detail),
    })
    const commandRepository = createHttpOwnerCommercialDocumentCommandRepository({
      fetcher: vi.fn().mockResolvedValue(validPenaltyForm()),
    })

    await expect(readRepository.get(parseOwnerCommercialDocumentDetailQuery(
      'owner_penalty',
      'owner-penalty-326',
      { origin: 'real' },
    ))).resolves.toMatchObject({
      document: { kind: 'owner_penalty', amounts: { kind: 'owner_penalty', amount: '36000.00' } },
      ownerPenaltyFacts: {
        noticeNo: 'LX-2026-326',
        penaltyDate: '2026-08-26',
        reason: '施工进度延误',
        appealNote: '已提交工期顺延说明',
      },
      files: [{ category: 'contact-letter' }],
      sourceNavigation: { filters: { ownerTab: 'settlements' } },
    })
    await expect(commandRepository.loadForm('owner_penalty', 'owner-penalty-326')).resolves.toMatchObject({
      kind: 'owner_penalty',
      draft: { noticeNo: 'LX-2026-326', amount: 36000, reason: '施工进度延误' },
      attachments: [{ ownerType: 'owner_penalty' }],
    })
  })

  it('拒绝缺少罚扣专属事实或联系单归属错误的响应', async () => {
    const detail = validPenaltyDetail()
    const malformedDetail = createHttpOwnerCommercialDocumentReadRepository({
      fetcher: vi.fn().mockResolvedValue({ ...detail, ownerPenaltyFacts: null }),
    })
    await expect(malformedDetail.get(parseOwnerCommercialDocumentDetailQuery(
      'owner_penalty',
      'owner-penalty-326',
      { origin: 'real' },
    ))).rejects.toMatchObject({ problem: { code: 'internal-error' } })

    const malformedForm = createHttpOwnerCommercialDocumentCommandRepository({
      fetcher: vi.fn().mockResolvedValue(validPenaltyForm({
        attachments: [{ ...validPenaltyForm().attachments[0], ownerType: 'project_penalty' }],
      })),
    })
    await expect(malformedForm.loadForm('owner_penalty', 'owner-penalty-326'))
      .rejects
      .toMatchObject({ problem: { code: 'internal-error' } })
  })

  it('拒绝顶层看似正确但嵌套列表项、命令上下文或附件畸形的响应', async () => {
    const malformedList = createHttpOwnerCommercialDocumentReadRepository({
      fetcher: vi.fn().mockResolvedValue({
        items: [{ id: 'change-323' }],
        pagination: { page: 1, pageSize: 20, total: 1 },
        summary: { projects: [], contracts: [], statuses: [], documentTypes: [], origins: {} },
        empty: null,
        asOf: '2026-08-25T00:00:00.000Z',
        sourceVersion: 'v1',
        capabilities: ['owner-document:read'],
      }),
    })
    await expect(malformedList.list(parseOwnerCommercialDocumentListQuery('owner_change', {})))
      .rejects
      .toMatchObject({ problem: { code: 'internal-error' } })

    const malformedContext = createHttpOwnerCommercialDocumentCommandRepository({
      fetcher: vi.fn().mockResolvedValue({
        workspaceId: 'workspace-323',
        actorId: 'actor-323',
        capabilities: ['owner-document:write'],
        projects: [{ id: 323, label: '错误项目', customerId: null }],
        customers: [],
        contracts: [],
      }),
    })
    await expect(malformedContext.context())
      .rejects
      .toMatchObject({ problem: { code: 'internal-error' } })
  })

  it.each([
    ['错误来源', { dataOrigin: 'archive' }],
    ['错误金额', { amounts: { kind: 'owner_change', boqChange: '320.00', taxInclusive: 'abc', taxExclusive: '300.00', appliedTaxExclusive: '301.00' } }],
    ['错误日期', { applicationDate: '2026-02-30' }],
  ])('拒绝%s的列表读模型', async (_label, overrides) => {
    const repository = createHttpOwnerCommercialDocumentReadRepository({
      fetcher: vi.fn().mockResolvedValue(validListPage(overrides)),
    })
    await expect(repository.list(parseOwnerCommercialDocumentListQuery('owner_change', {})))
      .rejects
      .toMatchObject({ problem: { code: 'internal-error' } })
  })

  it('拒绝小数或负数分页计数', async () => {
    const page = validListPage()
    page.pagination.page = 1.5
    page.pagination.total = -1
    const repository = createHttpOwnerCommercialDocumentReadRepository({ fetcher: vi.fn().mockResolvedValue(page) })
    await expect(repository.list(parseOwnerCommercialDocumentListQuery('owner_change', {})))
      .rejects
      .toMatchObject({ problem: { code: 'internal-error' } })
  })

  it.each([
    ['顶层稳定 ID 错误', { id: 'change-other' }],
    ['顶层单据类型错误', { kind: 'owner_report' }],
    ['draft 稳定 ID 错误', { draft: { ...validForm().draft, id: 'change-other' } }],
    ['draft 日期非法', { draft: { ...validForm().draft, applicationDate: '2026-02-30' } }],
    ['附件归属错误', { attachments: [{ ...validForm().attachments[0], ownerId: 'change-other' }] }],
    ['附件时间非法', { attachments: [{ ...validForm().attachments[0], uploadedAt: 'yesterday' }] }],
  ])('拒绝%s的表单响应', async (_label, overrides) => {
    const repository = createHttpOwnerCommercialDocumentCommandRepository({
      fetcher: vi.fn().mockResolvedValue(validForm(overrides)),
    })

    await expect(repository.loadForm('owner_change', 'change-323'))
      .rejects
      .toMatchObject({ problem: { code: 'internal-error' } })
  })
})
