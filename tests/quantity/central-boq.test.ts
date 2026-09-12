import type { OwnerCommercialDocumentCommandTestInstanceOptions } from '../../server/utils/owner-commercial-document-command-test-instance'
import { describe, expect, it } from 'vitest'
import { createHttpOwnerCommercialDocumentCommandRepository } from '~/lib/owner-document/central-http-repository'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'

const session = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['owner-document:read', 'owner-document:write'] }
const envelope = (commandId: string) => ({ ...session, requiredCapability: 'owner-document:write' as const, commandId })

function instance(qty: number | null = 100, unitPrice: number | null = 2, options: Partial<OwnerCommercialDocumentCommandTestInstanceOptions> = {}) {
  return createOwnerCommercialDocumentCommandTestInstance({
    now: () => '2026-09-11T02:00:00.000Z',
    createId: kind => `${kind}-new`,
    projects: [{ id: 'project', name: '测试项目', customerId: 'customer' }],
    customers: [{ id: 'customer', name: '测试客户' }],
    contracts: [{ id: 'contract', projectId: 'project', customerId: 'customer', no: 'HT-1', name: '施工合同' }],
    boqLines: [{ id: 'boq', projectId: 'project', contractId: 'contract', itemName: '抹灰', unit: '㎡', qty, unitPrice, autoQty: 0, missingQtyCount: 0 }],
    monthlyQuantityFacts: [{ projectId: 'project', contractId: 'contract', periodNo: '2026-09', boqLineId: 'boq', autoQty: 10, missingQtyCount: 0, quantityBasis: 'field', sourceVersion: 'quantity:1', sourceUpdatedAt: null }],
    documents: [],
    ...options,
  })
}

describe('中央 BOQ 原量与当前有效量价', () => {
  it('等待当前工程量期间客户端后续改输入不能改变已发送申报内容', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const owner = instance(100, 2, { withMonthlyQuantity: async (projectId, _sessionId, consume, basis) => {
      await gate
      return consume([{ projectId, contractId: 'contract', periodNo: '2026-09', boqLineId: 'boq', autoQty: 12, missingQtyCount: 0, quantityBasis: basis, sourceVersion: 'live:1', sourceUpdatedAt: null }])
    } })
    const command = {
      ...envelope('pending-report'),
      action: 'submit' as const,
      kind: 'owner_report' as const,
      id: null,
      baseVersion: null,
      draft: { projectId: 'project', contractId: 'contract', applicationDate: '2026-09-11', periodNo: '2026-09', lines: [{ boqLineId: 'boq', reportedQty: 12 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }
    const pending = owner.execute(command, session)
    command.draft.lines[0]!.reportedQty = 999
    release()
    const saved = await pending
    expect(owner.form('owner_report', saved.id, session).draft.reportedAmount).toBe(24)
  })

  it('中央工程量不可用仍可保存未提交草稿，基准保留且不伪造来源快照', async () => {
    const owner = instance(100, 2, { withMonthlyQuantity: async () => {
      throw new Error('模拟工程量不可用')
    } })
    const saved = await owner.execute({
      ...envelope('draft-without-quantity'),
      kind: 'owner_report',
      action: 'save',
      id: null,
      baseVersion: null,
      draft: { projectId: 'project', contractId: 'contract', periodNo: '2026-09', quantityBasis: 'provisional', lines: [{ boqLineId: 'boq', reportedQty: 13 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(owner.form('owner_report', saved.id, session).draft).toMatchObject({ status: 'draft', quantityBasis: 'provisional', quantitySourceVersion: null, lines: [expect.objectContaining({ reportedQty: 13 })] })
  })

  it('甲方清单 HTTP 保留 null 和零，并将所选报量基准传给当前端点', async () => {
    const line = { id: 'boq', itemName: '清单', unit: '㎡', qty: null, unitPrice: 0, autoQty: 0, missingQtyCount: 1 }
    let actualQuery: unknown
    const repository = createHttpOwnerCommercialDocumentCommandRepository({ fetcher: async (_url, options) => {
      actualQuery = options?.query
      return [line]
    } })
    expect(await repository.boqLines('project', 'contract', '2026-09', 'provisional')).toEqual([line])
    expect(actualQuery).toEqual({ projectId: 'project', contractId: 'contract', periodNo: '2026-09', quantityBasis: 'provisional' })
  })

  it('申报消费当前工程量，后续现场量变化不回写已提交快照，缺量要求人工确认', async () => {
    let autoQty = 12
    let missingQtyCount = 0
    let version = 'live:1'
    const owner = instance(100, 2, {
      withMonthlyQuantity: async (projectId, _sessionId, consume) => consume([{ projectId, contractId: 'contract', periodNo: '2026-09', boqLineId: 'boq', autoQty, missingQtyCount, quantityBasis: 'field', sourceVersion: version, sourceUpdatedAt: null }]),
    })
    const command = {
      ...envelope('current-report'),
      action: 'submit' as const,
      kind: 'owner_report' as const,
      id: null,
      baseVersion: null,
      draft: { projectId: 'project', contractId: 'contract', applicationDate: '2026-09-11', periodNo: '2026-09', lines: [{ boqLineId: 'boq' }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }
    const result = await owner.execute(command, session)
    expect(owner.form('owner_report', result.id, session).draft).toMatchObject({ reportedAmount: 24, quantitySourceVersion: 'live:1', lines: [expect.objectContaining({ autoQty: 12, reportedQty: 12 })] })
    autoQty = 50
    version = 'live:2'
    expect(await owner.execute(command, session)).toEqual(result)
    expect(owner.form('owner_report', result.id, session).draft.reportedAmount).toBe(24)
    missingQtyCount = 1
    await expect(owner.execute({ ...command, commandId: 'missing-report' }, session)).rejects.toThrow('缺量')
  })

  it('候选保留原量，已批调量仅独立提供一次，未审批的草稿不生效', async () => {
    const owner = instance()
    const before = owner.quantityBoqFacts('project')
    const change = await owner.execute({
      ...envelope('change'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: { name: '调量', reason: '测试现场变更', projectId: 'project', contractId: 'contract', applicationDate: '2026-09-11', lines: [{ boqLineId: 'boq', operation: 'qty', deltaQty: 5 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)
    expect(owner.quantityBoqFacts('project')).toEqual(before)
    await owner.execute({ ...envelope('approve'), action: 'approve', kind: 'owner_change', id: change.id, baseVersion: change.version, approvedAt: '2026-09-11' }, session)
    const current = owner.quantityBoqFacts('project')
    expect(current.lines).toEqual([expect.objectContaining({ id: 'boq', qty: 100, unitPrice: 2, approvedDeltaQty: 5, effectiveUnitPrice: 2 })])
    expect(current.sourceVersion).not.toBe(before.sourceVersion)
    expect(owner.quantityBoqFacts('other').lines).toEqual([])
    expect(instance(null, null).quantityBoqFacts('project').lines[0]).toMatchObject({ qty: null, unitPrice: null, effectiveUnitPrice: null })
  })

  it.each([[null, 2], [100, null]])('未知原量或原价不能被当作零审批调量：%s / %s', async (qty, price) => {
    const owner = instance(qty, price)
    await expect(owner.execute({
      ...envelope('unknown-change'),
      action: 'submit',
      kind: 'owner_change',
      id: null,
      baseVersion: null,
      draft: { name: '调量', reason: '测试现场变更', projectId: 'project', contractId: 'contract', applicationDate: '2026-09-11', lines: [{ boqLineId: 'boq', operation: 'qty', deltaQty: 1 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }, session)).rejects.toThrow('未知')
  })

  it('未知单价不能生成零金额月报，已知零单价仍可申报', async () => {
    const command = {
      ...envelope('report'),
      action: 'submit' as const,
      kind: 'owner_report' as const,
      id: null,
      baseVersion: null,
      draft: { projectId: 'project', contractId: 'contract', applicationDate: '2026-09-11', periodNo: '2026-09', lines: [{ boqLineId: 'boq', reportedQty: 10 }] },
      attachments: { add: [], removeIds: [], restoreIds: [] },
    }
    await expect(instance(100, null).execute(command, session)).rejects.toThrow('单价未知')
    const owner = instance(100, 0)
    const result = await owner.execute(command, session)
    expect(owner.form('owner_report', result.id, session).draft.reportedAmount).toBe(0)
  })
})
