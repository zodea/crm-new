// @vitest-environment jsdom
import type { BoqBuildingContext } from '~/lib/boq/central-building-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRecoveryKey } from '~/lib/forms/command-recovery'
import { projectProblem, ProjectRepositoryProblem } from '~/lib/project/repository'
import { useBoqBuildingStore } from '~/stores/boq-building'

const value: BoqBuildingContext = { workspaceId: 'w', actorId: 'a', origin: 'real', projectId: 'p', contractId: 'c', contractName: '施工合同', sourceVersion: 'fixed-version', capabilities: ['owner-document:write'], buildings: [], lines: [], audit: [] }
const repository = { read: vi.fn(), execute: vi.fn() }
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  repository.read.mockReset().mockResolvedValue(value)
  repository.execute.mockReset().mockImplementation(async command => ({ ...command, sourceVersion: 'after', auditId: 'audit' }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { boqBuilding: repository } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('楼栋证据中央命令状态', () => {
  it('正式迟到recover保持固定原scope，不能读取或污染新主合同；回原页只核原编号', async () => {
    const formal: BoqBuildingContext = { ...value, workspaceId: 'boq-workspace', actorId: 'boq-owner', projectId: 'project-one', contractId: 'contract-one', contractVersion: 'actual-main', lines: [{ id: 'boq-line-one', itemName: '实际原清单', unit: '㎡', qty: 0, unitPrice: 17, effectiveQty: 0, effectiveUnitPrice: 17, building: null, sourceKind: 'confirmed-import', readOnlyReason: null, version: 'actual-line' }], buildings: [{ id: 'building-one', code: '1', name: '实际1栋', version: 'actual-building' }] }
    repository.read.mockImplementation(async query => query.projectId === 'project-one' ? formal : { ...formal, projectId: 'project-two', contractId: 'contract-two', audit: [], lines: [] })
    repository.execute.mockRejectedValueOnce(new Error('formal write response lost'))
    const store = useBoqBuildingStore()
    await store.read({ projectId: formal.projectId, contractId: formal.contractId, origin: 'real' })
    await expect(store.save(formal, 'boq-line-one', 'building-one', '原件核对')).rejects.toThrow('formal write response lost')
    const descriptor = store.pendingCommand!
    const markerKey = commandRecoveryKey(descriptor as import('~/lib/forms/command-recovery').CommandRecoveryDescriptor)
    const stored = sessionStorage.getItem(markerKey)!
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
    let finish: (value: unknown) => void = () => {}
    vi.stubGlobal('$fetch', vi.fn(async () => new Promise((resolve) => {
      finish = resolve
    })))
    const recovering = store.recover()
    await vi.waitFor(() => expect(vi.mocked(globalThis.$fetch)).toHaveBeenCalled())
    await store.read({ projectId: 'project-two', contractId: 'contract-two', origin: 'real' })
    const result = { workspaceId: formal.workspaceId, actorId: formal.actorId, commandId: descriptor.commandId, projectId: formal.projectId, contractId: formal.contractId, action: 'correct-building', id: 'boq-line-one', sourceVersion: 'saved', buildingResult: { commandId: descriptor.commandId, projectId: formal.projectId, contractId: formal.contractId, lineId: 'boq-line-one', buildingId: 'building-one', building: '1', sourceVersion: 'saved', auditId: 'actual-building-audit' } }
    finish({ outcome: 'applied', result })
    await recovering
    expect(store.context?.projectId).toBe('project-two')
    expect(repository.read.mock.calls.at(-1)![0].projectId).toBe('project-two')
    expect(sessionStorage.getItem(markerKey)).toBe(stored)
    expect(store.pendingCommand).toBeNull()
    await store.read({ projectId: formal.projectId, contractId: formal.contractId, origin: 'real' })
    expect(store.pendingCommand?.commandId).toBe(descriptor.commandId)
    vi.stubGlobal('$fetch', vi.fn(async () => ({ outcome: 'applied', result })))
    await expect(store.recover()).rejects.toThrow('读取未完成')
    expect(store.knownSaved).toBe(true)
    expect(sessionStorage.getItem(markerKey)).toBe(stored)
    repository.read.mockResolvedValue({ ...formal, lines: formal.lines.map(line => ({ ...line, building: '1' })), audit: [{ id: 'actual-building-audit', commandId: descriptor.commandId, lineId: 'boq-line-one', buildingId: 'building-one' }] })
    await store.recover()
    expect(store.pendingCommand).toBeNull()
    expect(sessionStorage.getItem(markerKey)).toBeNull()
    expect(repository.execute).toHaveBeenCalledTimes(1)
  })
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
    await expect(store.save(value, 'line', 'building', '核对原件')).rejects.toThrow('旧版本')
    expect(store.pendingCommand).toBeNull()
    repository.read.mockRejectedValueOnce(new Error('写后回读失败'))
    await expect(store.save(value, 'line', 'building', '核对原件')).rejects.toThrow('写后回读失败')
    expect(store.pendingCommand).not.toBeNull()
  })
})
