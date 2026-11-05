import type { ProcessLibraryCatalog, ProcessLibraryCreateCommand, ProcessLibraryVersion } from '~/lib/schedule/process-library-contract'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { processLibraryProblem } from '~/lib/schedule/process-library-contract'
import { createProcessLibraryState } from '~/lib/schedule/process-library-state'

function version(id = 'old', number = 1): ProcessLibraryVersion {
  return { id, code: 'interior', name: '室内', description: '旧版', version: number, isDefault: false, taskCount: 1, usageCount: null, dataOrigin: 'real', sourceVersion: `revision-${id}`, sourceVersionId: null, sortOrder: 0, createdAt: null, createdBy: null, updatedAt: null, deletedAt: null, migrationBatchId: null, legacyId: null, tasks: [{ id: `${id}-task`, libraryId: id, libraryVersion: number, key: 'a', name: '放线', durationDays: 2, trade: '', color: '#64748b', itemCodes: [], sortOrder: 10, predecessorKey: null, predecessorDisabled: false, legacyId: null, createdAt: null, updatedAt: null, deletedAt: null }] }
}
function catalog(max = 3): ProcessLibraryCatalog {
  return { origin: 'real', workspaceId: 'workspace', actorId: 'actor', capabilities: ['process-library:read', 'process-library:write'], sourceVersion: `catalog-${max}`, seriesVersions: { interior: max }, libraries: [version(), version('latest', max)] }
}
const draft = { sourceLibraryId: 'old', code: 'interior', name: '人工修改', description: '', tasks: [{ key: 'a', name: '放线', durationDays: 3, trade: '', color: '#64748b', stageCode: '', itemCodes: [], predecessorKey: null, predecessorDisabled: false }] }
function harness() {
  const origin = shallowRef<'real' | 'demo'>('real')
  const repository = { list: vi.fn(async () => catalog()), detail: vi.fn(async (id: string) => version(id)), execute: vi.fn(async (command: ProcessLibraryCreateCommand) => ({ commandId: command.commandId, id: 'created', version: 4, sourceVersion: 'revision-created' })) }
  let nextId = 0
  const state = createProcessLibraryState(repository, () => origin.value, () => `command-${++nextId}`)
  return { state, repository, origin }
}

describe('中央工序库公开状态', () => {
  it('同源目录刷新及暂时网络失败保留最后成功数据，重新成功前均禁写', async () => {
    const { state, repository } = harness()
    await state.loadLibraries()
    const previous = state.libraries.value
    let fail!: (cause: Error) => void
    repository.list.mockImplementationOnce(() => new Promise((_resolve, reject) => fail = reject))
    const refresh = state.loadLibraries().catch(cause => cause)
    expect(state.libraries.value).toBe(previous)
    expect(state.loading.value).toBe(true)
    expect(state.canWrite.value).toBe(false)
    fail(new Error('网络暂不可用'))
    await refresh
    expect(state.libraries.value).toBe(previous)
    expect(state.error.value).toBe('网络暂不可用')
    expect(state.canWrite.value).toBe(false)
    await state.loadLibraries()
    expect(state.error.value).toBe('')
    expect(state.canWrite.value).toBe(true)
  })

  it('详情目标切换只撤旧详情，同源全局目录继续可读；权限失效撤所有旧记录', async () => {
    const { state, repository } = harness()
    await state.loadDetail('old')
    let finish!: (value: ProcessLibraryVersion) => void
    repository.detail.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const next = state.loadDetail('next')
    expect(state.detail.value).toBeNull()
    expect(state.libraries.value).toHaveLength(2)
    expect(state.canWrite.value).toBe(false)
    finish(version('next'))
    await next
    repository.list.mockRejectedValueOnce(processLibraryProblem('forbidden', '会话权限失效'))
    await expect(state.loadLibraries()).rejects.toThrow('会话权限失效')
    expect(state.context.value).toBeNull()
    expect(state.libraries.value).toEqual([])
    expect(state.detail.value).toBeNull()
  })

  it.each((['constructor', 'toString', '__proto__']).map(input => ({ input })))('与对象原型同名的合法新编码使用零基准，已有同名系列使用自身版本：输入案例 %#', async ({ input: code }) => {
    const { state, repository } = harness()
    await state.loadLibraries()
    await state.saveVersion({ ...draft, sourceLibraryId: null, code })
    expect(repository.execute.mock.calls[0]![0].baseVersion).toBe(0)
    repository.list.mockResolvedValue({ ...catalog(), seriesVersions: Object.fromEntries([[code, 2]]) })
    await state.loadLibraries()
    await state.saveVersion({ ...draft, sourceLibraryId: null, code })
    expect(repository.execute.mock.calls[1]![0].baseVersion).toBe(2)
  })

  it('未读不能保存；从任意旧版复制使用已读同编码最高版及旧版来源凭据', async () => {
    const { state, repository } = harness()
    await expect(state.saveVersion(draft)).rejects.toThrow('尚未读取当前来源及写入权限')
    expect(repository.execute).not.toHaveBeenCalled()
    await state.loadDetail('old')
    const baseline = state.readVersion.value
    await state.saveVersion(draft, baseline)
    expect(repository.execute).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: 3, sourceVersion: 'revision-old', draft: expect.objectContaining({ sourceLibraryId: 'old' }) }))
    expect(state.detail.value?.id).toBe('created')
  })

  it('响应不确定时原意图复用 commandId，明确冲突后必须显式重读才可再次保存', async () => {
    const { state, repository } = harness()
    await state.loadDetail('old')
    const baseline = state.readVersion.value
    repository.execute.mockRejectedValueOnce(new Error('网络断开'))
    await expect(state.saveVersion(draft, baseline)).rejects.toThrow('网络断开')
    repository.execute.mockRejectedValueOnce(processLibraryProblem('conflict', '同编码已新增版本'))
    await expect(state.saveVersion(draft, baseline)).rejects.toThrow('同编码已新增版本')
    expect(repository.execute.mock.calls[0]![0].commandId).toBe(repository.execute.mock.calls[1]![0].commandId)
    await expect(state.saveVersion(draft, baseline)).rejects.toThrow(/重新核对/)
    expect(repository.execute).toHaveBeenCalledTimes(2)
    repository.list.mockResolvedValue(catalog(4))
    await state.recheckSeries('interior', 'old')
    await state.saveVersion(draft, state.readVersion.value)
    expect(repository.execute.mock.calls[2]![0].baseVersion).toBe(4)
    expect(repository.execute.mock.calls[2]![0].commandId).not.toBe(repository.execute.mock.calls[1]![0].commandId)
  })

  it('同一份草稿保留已读基准，不随别的页面列表刷新自动升级', async () => {
    const { state, repository } = harness()
    await state.loadDetail('old')
    const baseline = state.readVersion.value
    repository.list.mockResolvedValue(catalog(7))
    await state.loadLibraries()
    await state.saveVersion(draft, baseline)
    expect(repository.execute.mock.calls[0]![0].baseVersion).toBe(3)
  })

  it('来源变化立即禁写，旧读取迟到不覆盖新来源；演示只读', async () => {
    const { state, repository, origin } = harness()
    let resolveOld!: (value: ProcessLibraryCatalog) => void
    repository.list.mockImplementationOnce(() => new Promise(resolve => resolveOld = resolve))
    const oldRead = state.loadLibraries().catch(() => undefined)
    origin.value = 'demo'
    repository.list.mockResolvedValue({ ...catalog(), origin: 'demo', libraries: [] })
    await state.loadLibraries()
    resolveOld(catalog())
    await oldRead
    expect(state.libraries.value).toEqual([])
    expect(state.context.value?.origin).toBe('demo')
    expect(state.canWrite.value).toBe(false)
    await expect(state.saveVersion(draft)).rejects.toThrow('尚未读取当前来源及写入权限')
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('detail 快速切换只发布最后版本，取消读取后不发布结果', async () => {
    const { state, repository } = harness()
    let resolveOld!: (value: ProcessLibraryVersion) => void
    repository.detail.mockImplementationOnce(() => new Promise(resolve => resolveOld = resolve))
    const oldRead = state.loadDetail('old').catch(() => undefined)
    await state.loadDetail('next')
    resolveOld(version())
    await oldRead
    expect(state.detail.value?.id).toBe('next')
  })

  it('权限重读失败会撤销写权限，不偷偷降级旧库', async () => {
    const { state, repository } = harness()
    await state.loadDetail('old')
    const baseline = state.readVersion.value
    repository.list.mockRejectedValueOnce(processLibraryProblem('forbidden', '权限已撤销'))
    await expect(state.recheckSeries('interior', 'old')).rejects.toThrow('权限已撤销')
    expect(state.canWrite.value).toBe(false)
    await expect(state.saveVersion(draft, baseline)).rejects.toThrow('尚未读取当前来源及写入权限')
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('已删除最高版仍计入系列基准，复制可见旧版不会撞旧版本号', async () => {
    const { state, repository } = harness()
    repository.list.mockResolvedValue({ ...catalog(2), libraries: [version()] })
    await state.loadDetail('old')
    await state.saveVersion(draft)
    expect(repository.execute.mock.calls[0]![0].baseVersion).toBe(2)
  })

  it('保存迟到于同源目标切换不覆盖新详情，返回原意图时复用已经提交的 commandId', async () => {
    const { state, repository } = harness()
    await state.loadDetail('old')
    let finish!: (value: { commandId: string, id: string, version: number, sourceVersion: string }) => void
    repository.execute.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const save = state.saveVersion(draft).catch(cause => cause)
    await state.loadDetail('other')
    const commandId = repository.execute.mock.calls[0]![0].commandId
    finish({ commandId, id: 'created', version: 4, sourceVersion: 'source-created' })
    expect(await save).toBeInstanceOf(DOMException)
    expect(state.detail.value?.id).toBe('other')
    expect(state.error.value).toBe('')
    expect(state.conflict.value).toBe(false)
    repository.list.mockResolvedValue(catalog(4))
    await state.loadDetail('old')
    await state.saveVersion(draft)
    expect(repository.execute.mock.calls[1]![0].commandId).toBe(commandId)
    expect(repository.execute.mock.calls[1]![0].baseVersion).toBe(3)
  })

  it('命令已成功但详情读取迟到于目标切换，也不发布旧详情或错误', async () => {
    const { state, repository } = harness()
    await state.loadDetail('old')
    let finish!: (value: ProcessLibraryVersion) => void
    repository.detail.mockImplementation(async id => id === 'created' ? new Promise(resolve => finish = resolve) : version(id))
    const save = state.saveVersion(draft).catch(cause => cause)
    await vi.waitFor(() => expect(repository.detail).toHaveBeenCalledWith('created', 'real'))
    await state.loadDetail('other')
    finish(version('created'))
    expect(await save).toBeInstanceOf(DOMException)
    expect(state.detail.value?.id).toBe('other')
    expect(state.error.value).toBe('')
  })
})
