import type { OwnerCommercialDocumentCommandRepository, OwnerCommercialDocumentCommandResultDTO } from '~/lib/owner-document/central-command-contract'
import type { OwnerCommercialDocumentKind } from '~/lib/owner-document/central-repository'
import { describe, expect, it, vi } from 'vitest'
import {
  createOwnerDocumentCommandSession,
} from '~/lib/owner-document/command-intent'

function recoveryFixture(kind: OwnerCommercialDocumentKind) {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  const context = { workspaceId: 'recovery-workspace', actorId: 'recovery-actor', capabilities: ['owner-document:write', 'subcontract-document:write'], projects: [], customers: [], suppliers: [], contracts: [] }
  let saved: OwnerCommercialDocumentCommandResultDTO | null = null
  let readFailure = false
  let unknown = false
  const repository: OwnerCommercialDocumentCommandRepository = {
    context: async () => structuredClone(context),
    loadForm: vi.fn(async (_kind, id) => {
      if (readFailure)
        throw new Error('模拟已保存读取失败')
      return { kind, id, draft: { id, name: '已存单据' }, attachments: [], version: saved?.version ?? '1', updatedAt: '2026-10-07T08:00:00.000Z' }
    }),
    boqLines: async () => [],
    execute: vi.fn(async (request) => {
      saved = { id: request.id ?? 'saved-business-document', commandId: request.commandId, version: '2', updatedAt: '2026-10-07T08:00:00.000Z', attachmentIds: [], deleted: false }
      if (unknown)
        throw new Error('模拟响应断开')
      return saved
    }),
    resolve: vi.fn(async (_kind, descriptor) => saved ? { outcome: 'applied', result: saved } : { outcome: 'not-applied', commandId: descriptor.commandId }),
  }
  return {
    repository,
    context,
    values,
    storage,
    readFailure: (value: boolean) => { readFailure = value },
    unknown: (value: boolean) => { unknown = value },
  }
}

describe('甲方商务单据命令意图', () => {
  it('删除后的其他新回执不能替原key释放，只接受同原删除编号的可靠只读后读', async () => {
    const f = recoveryFixture('owner_penalty')
    const current = createOwnerDocumentCommandSession('owner_penalty', () => f.repository, () => f.storage)
    await current.actions.hydrate(current.session, 'saved-business-document')
    let originalKey = ''
    f.repository.execute = vi.fn(async (request) => {
      originalKey = request.commandId
      return { id: 'saved-business-document', commandId: originalKey, version: '2', updatedAt: '2026-10-08T00:00:00.000Z', attachmentIds: [], deleted: true }
    })
    let proofKey = 'unrelated-new-delete'
    let deletedAt = '2026-10-08T00:00:00.000Z'
    f.repository.loadForm = vi.fn(async () => ({ kind: 'owner_penalty', id: 'saved-business-document', draft: { id: 'saved-business-document', status: 'draft' }, attachments: [], version: '2', updatedAt: '2026-10-08T00:00:00.000Z', readOnly: true, deletionVerification: { commandId: proofKey, deletedAt } }))
    await expect(current.actions.saveForm(current.session, { id: 'saved-business-document' }, 'delete', {})).rejects.toThrow('已保存待刷新')
    expect(f.values.size).toBe(1)
    proofKey = originalKey
    await expect(current.actions.recover(current.session)).resolves.toMatchObject({ outcome: 'applied', form: { readOnly: true, deletionVerification: { commandId: originalKey } } })
    expect(f.values.size).toBe(0)
    expect(current.session.pending).toBeNull()
    expect(f.repository.execute).toHaveBeenCalledTimes(1)
    await expect(current.actions.revalidate(current.session)).resolves.toMatchObject({ form: { readOnly: true, deletionVerification: { commandId: originalKey, deletedAt } } })
    expect(f.values.size).toBe(0)
    deletedAt = '2026-10-08T01:00:00.000Z'
    await expect(current.actions.revalidate(current.session)).rejects.toThrow('原删除编号或日期不同')
    deletedAt = '2026-10-08T00:00:00.000Z'
    proofKey = 'unrelated-new-delete'
    await expect(current.actions.revalidate(current.session)).rejects.toThrow('原删除编号或日期不同')
    f.context.actorId = 'other-actor'
    await expect(current.actions.revalidate(current.session)).rejects.toThrow('当前身份或权限已变化')
  })

  it.each(['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty', 'sub_change', 'sub_settlement', 'project_penalty'] as const)('%s 回执后读取失败保原号，只回读同单后释放，不重复写', async (kind) => {
    const f = recoveryFixture(kind)
    const current = createOwnerDocumentCommandSession(kind, () => f.repository, () => f.storage)
    await current.actions.hydrate(current.session, null)
    f.readFailure(true)
    await expect(current.actions.saveForm(current.session, { name: '保留输入' }, 'save', {})).rejects.toThrow('已保存待刷新')
    expect(f.values.size).toBe(1)
    const descriptor = JSON.parse([...f.values.values()][0]!)
    expect(Object.keys(descriptor).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
    expect(descriptor).toMatchObject({ family: 'owner-commercial-document', scopeId: kind, targetId: null })
    expect(current.session.pending?.result?.commandId).toBe(descriptor.commandId)
    await expect(current.actions.saveForm(current.session, { name: '不同正文' }, 'save', {})).rejects.toThrow('已保存待刷新')
    f.readFailure(false)
    const read = await current.actions.recover(current.session)
    expect(read).toMatchObject({ outcome: 'applied', form: { kind, id: 'saved-business-document' } })
    expect(f.repository.execute).toHaveBeenCalledTimes(1)
    expect(f.values.size).toBe(0)
  })

  it('结果未知刷新仍核对原编号，撤权不能清标记，另一单据类型不消费恢复记录', async () => {
    const f = recoveryFixture('owner_report')
    const original = createOwnerDocumentCommandSession('owner_report', () => f.repository, () => f.storage)
    await original.actions.hydrate(original.session, null)
    f.unknown(true)
    await expect(original.actions.saveForm(original.session, { name: '月报输入' }, 'submit', {})).rejects.toThrow('响应断开')
    const originalId = original.session.pending!.id
    const other = createOwnerDocumentCommandSession('acceptance', () => f.repository, () => f.storage)
    await other.actions.hydrate(other.session, null)
    expect(f.values.size).toBe(1)
    const cold = createOwnerDocumentCommandSession('owner_report', () => f.repository, () => f.storage)
    f.context.capabilities = []
    await expect(cold.actions.hydrate(cold.session, null)).rejects.toThrow('权限')
    expect(f.values.size).toBe(1)
    f.context.capabilities = ['owner-document:write']
    const recovered = await cold.actions.hydrate(cold.session, null)
    expect(recovered).toMatchObject({ recovered: true, recoveryOutcome: 'applied', form: { id: 'saved-business-document' } })
    expect(f.repository.resolve).toHaveBeenCalledWith('owner_report', expect.objectContaining({ commandId: originalId }))
    expect(f.repository.execute).toHaveBeenCalledTimes(1)
    expect(f.values.size).toBe(0)
  })
  it('未知结果先核对同一原编号，同正文和改正文都不能再执行业务写入', async () => {
    const f = recoveryFixture('owner_report')
    const current = createOwnerDocumentCommandSession('owner_report', () => f.repository, () => f.storage)
    await current.actions.hydrate(current.session, null)
    f.unknown(true)
    const draft = { name: '月度报量' }
    await expect(current.actions.saveForm(current.session, draft, 'submit', {})).rejects.toThrow('响应断开')
    const originalId = current.session.pending!.id
    await expect(current.actions.saveForm(current.session, draft, 'submit', {})).rejects.toThrow('结果未知')
    await expect(current.actions.saveForm(current.session, { name: '另一正文' }, 'submit', {})).rejects.toThrow('结果未知')
    expect(current.session.pending!.id).toBe(originalId)
    expect(f.repository.execute).toHaveBeenCalledTimes(1)
  })

  it('可靠回执和同单后读完成后，新意图才生成新原号且保持既有稳定单据', async () => {
    const f = recoveryFixture('owner_report')
    const current = createOwnerDocumentCommandSession('owner_report', () => f.repository, () => f.storage)
    await current.actions.hydrate(current.session, null)
    const first = await current.actions.saveForm(current.session, { name: '月度报量' }, 'save', {})
    const changed = await current.actions.saveForm(current.session, { id: first.id, name: '月度报量（修订）' }, 'save', {})
    expect(changed.commandId).not.toBe(first.commandId)
    expect(changed.id).toBe(first.id)
    expect(f.values.size).toBe(0)
    expect(f.repository.execute).toHaveBeenCalledTimes(2)
  })
})
