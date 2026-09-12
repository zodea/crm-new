import type { BoqBuildingContext } from '~/lib/boq/central-building-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'
import { useBoqBuildingStore } from '~/stores/boq-building'

const value: BoqBuildingContext = { workspaceId: 'w', actorId: 'a', origin: 'real', projectId: 'p', contractId: 'c', contractName: '施工合同', sourceVersion: 'fixed-version', capabilities: ['owner-document:write'], buildings: [], lines: [], audit: [] }
const repository = { read: vi.fn(), execute: vi.fn() }
beforeEach(() => {
  setActivePinia(createPinia())
  repository.read.mockReset().mockResolvedValue(value)
  repository.execute.mockReset().mockImplementation(async command => ({ ...command, sourceVersion: 'after', auditId: 'audit' }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { boqBuilding: repository } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('楼栋证据中央命令状态', () => {
  it('固定原读版本，响应丢失后禁止新稿并恢复同一命令', async () => {
    const store = useBoqBuildingStore()
    await store.read({ projectId: 'p', contractId: 'c', origin: 'real' })
    repository.execute.mockRejectedValueOnce(new Error('响应丢失'))
    await expect(store.save(value, 'line', 'building', '核对原件')).rejects.toThrow('响应丢失')
    const first = repository.execute.mock.calls[0]![0]
    expect(first.sourceVersion).toBe('fixed-version')
    expect(store.pendingCommand?.commandId).toBe(first.commandId)
    expect(() => store.save(value, 'line', 'other', '新稿')).toThrow('请先核对原提交')
    repository.read.mockResolvedValue({ ...value, sourceVersion: 'newer-global' })
    await store.read({ projectId: 'p', contractId: 'c', origin: 'real' })
    await store.recover()
    expect(repository.execute.mock.calls[1]![0]).toEqual(first)
    expect(store.pendingCommand).toBeNull()
  })
  it('明确未应用的陈旧拒绝释放原命令供重读，已保存后读回失败仍保原命令', async () => {
    const store = useBoqBuildingStore()
    await store.read({ projectId: 'p', contractId: 'c', origin: 'real' })
    repository.execute.mockImplementationOnce(async (command) => {
      throw new ProjectRepositoryProblem({ ...projectProblem('stale-source', '旧版本'), commandId: command.commandId, commandOutcome: 'not-applied' })
    })
    await expect(store.save(value, 'line', 'building', '核对原件')).rejects.toThrow()
    expect(store.pendingCommand).toBeNull()
    repository.read.mockRejectedValueOnce(new Error('写后回读失败'))
    await expect(store.save(value, 'line', 'building', '核对原件')).rejects.toThrow('写后回读失败')
    expect(store.pendingCommand).not.toBeNull()
  })
})
