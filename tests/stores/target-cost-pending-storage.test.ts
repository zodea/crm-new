// @vitest-environment jsdom
import type { TargetCostCommand, TargetCostFormRead } from '~/lib/target-cost/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { commandRecoveryKey } from '~/lib/forms/command-recovery'
import { useTargetCostStore } from '~/stores/target-cost'

const repo = { execute: vi.fn(), form: vi.fn(), resolve: vi.fn() }
const read: TargetCostFormRead = { context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'budget:1+projects:p', capabilities: ['target-cost:read', 'target-cost:write'] }, targetCostId: null, draftKey: 'draft', draft: {}, deletedAt: null, files: [], projects: [], projectOptionsStatus: 'available' }
const receipt = (command: TargetCostCommand) => ({ commandId: command.commandId, id: 'saved-id', sourceVersion: 'budget:2+projects:p', attachmentIds: [], affectedVersionIds: ['saved-id'], logIds: [] })
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.resetAllMocks()
  repo.execute.mockImplementation(async command => receipt(command))
  repo.form.mockResolvedValue({ ...read, targetCostId: 'saved-id', draftKey: null, context: { ...read.context, sourceVersion: 'budget:2+projects:p' } })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { targetCosts: repo } }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Replaces the legacy full-body storage assertion while keeping its reliable-registration and original-intent protections.
it('原编号不能可靠登记时阻断发送，正文附件仅在内存，恢复存储后保原稿重试', async () => {
  const store = useTargetCostStore()
  const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  const files = { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] }
  expect(() => store.saveForm(read, { name: '保留原稿' }, 'draft', files)).toThrow('尚未发送')
  expect(repo.execute).not.toHaveBeenCalled()
  expect(store.getPending(read)).toBeNull()
  expect(files.add[0]?.payloadBase64).toBe('YWJj')
  quota.mockRestore()
  await store.saveForm(read, { name: '保留原稿' }, 'draft', files)
  expect(repo.execute).toHaveBeenCalledTimes(1)
  expect(repo.form).toHaveBeenCalledWith({ origin: 'real' }, 'saved-id')
})

it('失响应保内存原文，刷新只保最小编号并resolve原结果，不能重新发送正文或附件', async () => {
  const store = useTargetCostStore()
  let applied!: ReturnType<typeof receipt>
  repo.execute.mockImplementation(async (command: TargetCostCommand) => {
    applied = receipt(command)
    const persisted = sessionStorage.getItem(commandRecoveryKey({ workspaceId: 'workspace', actorId: 'actor', family: 'target-cost', targetId: null, scopeId: 'draft' }))!
    expect(JSON.parse(persisted)).toMatchObject({ commandId: command.commandId, scopeId: 'draft', action: 'save-header' })
    expect(persisted).not.toContain('YWJj')
    expect(persisted).not.toContain('预算.xlsx')
    expect(persisted).not.toContain('原私密名称')
    throw new Error('响应丢失')
  })
  await expect(store.saveForm(read, { name: '原私密名称' }, 'draft', { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] })).rejects.toThrow('响应丢失')
  const original = store.getPending(read)!
  expect(original.command?.action).toMatchObject({ draft: { name: '原私密名称' }, files: { add: [{ payloadBase64: 'YWJj' }] } })
  store.$dispose()
  setActivePinia(createPinia())
  const restored = useTargetCostStore()
  expect(restored.getPending(read)).toMatchObject({ descriptor: original.descriptor, command: null })
  repo.resolve.mockResolvedValue({ outcome: 'applied', result: applied })
  await restored.recover(restored.getPending(read)!)
  expect(repo.execute).toHaveBeenCalledTimes(1)
  expect(repo.resolve).toHaveBeenCalledWith(original.descriptor)
  expect(restored.getPending(read)).toBeNull()
})

it('已保存后读失败保原编号，恢复只重读；新输入保留，撤权回读不能清理', async () => {
  const store = useTargetCostStore()
  const displayed = computed(() => store.getPending(read))
  expect(displayed.value).toBeNull()
  const draft = { name: '原输入' }
  repo.form.mockRejectedValueOnce(new Error('后读暂时失败'))
  await expect(store.saveForm(read, draft, 'draft')).rejects.toThrow('后读暂时失败')
  const pending = store.getPending(read)!
  expect(pending.state).toBe('applied')
  expect(displayed.value?.state).toBe('applied')
  draft.name = '后来输入'
  repo.form.mockResolvedValueOnce({ ...read, targetCostId: 'saved-id', context: { ...read.context, actorId: 'other', sourceVersion: 'budget:2+projects:p' } })
  await expect(store.recover(pending)).rejects.toThrow('可靠读取')
  expect(store.getPending(read)?.descriptor.commandId).toBe(pending.descriptor.commandId)
  await store.recover(pending)
  expect(repo.execute).toHaveBeenCalledTimes(1)
  expect(repo.resolve).not.toHaveBeenCalled()
  expect(draft.name).toBe('后来输入')
  expect(store.getPending(read)).toBeNull()
  expect(displayed.value).toBeNull()
})

it('两个新建草稿的最小编号独立，旧完整pending先安全接续再清正文', async () => {
  const store = useTargetCostStore()
  repo.execute.mockRejectedValue(new Error('未知结果'))
  await expect(store.saveForm(read, { name: 'A私密' }, 'draft')).rejects.toThrow()
  const other = { ...read, draftKey: 'other-draft' }
  await expect(store.saveForm(other, { name: 'B私密' }, 'draft')).rejects.toThrow()
  expect(store.getPending(read)?.descriptor.commandId).not.toBe(store.getPending(other)?.descriptor.commandId)
  expect(store.getPending({ ...read, context: { ...read.context, origin: 'demo' } })).toBeNull()
  const old = store.getPending(read)!.command!
  sessionStorage.clear()
  sessionStorage.setItem('target-cost-central-pending-v1', JSON.stringify({ legacy: old }))
  store.$dispose()
  setActivePinia(createPinia())
  const replacement = useTargetCostStore()
  expect(replacement.getPending(read)?.command).toEqual(old)
  expect(sessionStorage.getItem('target-cost-central-pending-v1')).toBeNull()
  const remaining = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.getItem(sessionStorage.key(index)!)).join('')
  expect(remaining).not.toContain('A私密')
})
