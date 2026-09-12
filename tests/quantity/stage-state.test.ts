import type { QuantityReadResult } from '~/lib/quantity/central-contract'
import type { QuantityStageWorkspace } from '~/lib/quantity/central-stages'
import { describe, expect, it, vi } from 'vitest'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { createQuantityStageState } from '~/lib/quantity/stage-state'

const context = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['quantity:read', 'quantity:write', 'project:list:read'] }
const query = { projectId: 'project-a', origin: 'real' as const, includeDemo: false }
function envelope(projectId = query.projectId, version = 'version-1'): QuantityReadResult<QuantityStageWorkspace> {
  return { data: { projectId, matrixArchivedAt: null, stages: [], items: [], mappings: [] }, sourceVersion: version, dataOrigin: 'real', asOf: '2026-09-11T00:00:00.000Z', capabilities: context.capabilities }
}
const action = { kind: 'save-stage' as const, allowArchivedEdit: false, draft: { id: null, code: 'A', name: '第一阶段', trade: '油漆工', completionMode: 'unit' as const, sortOrder: 0, itemIds: [] } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('阶段配置编辑会话', () => {
  it('固定编辑读取版本，保存失败不重读或前移版本，同内容重试复用命令身份', async () => {
    const read = vi.fn().mockResolvedValue(envelope())
    const execute = vi.fn().mockRejectedValueOnce(quantityProblem('unavailable', '网络中断')).mockResolvedValue({ commandId: 'unused', id: 'stage-a', logIds: [], sourceVersion: 'version-2' })
    const state = createQuantityStageState({ read, context: async () => context, execute })
    await state.load(query)
    await expect(state.execute(action)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(state.baseVersion.value).toBe('version-1')
    await state.execute(action)
    const [first, second] = execute.mock.calls.map(call => call[0])
    expect(first.commandId).toBe(second.commandId)
    expect(first).toMatchObject({ workspaceId: context.workspaceId, actorId: context.actorId, projectId: query.projectId, baseVersion: 'version-1', action })
    expect(second.baseVersion).toBe('version-1')
    expect(read).toHaveBeenCalledTimes(1)
    expect(state.baseVersion.value).toBe('version-2')
  })

  it('切换项目撤旧事实，先前读取迟到不能覆盖新项目；来源错配明确失败', async () => {
    const first = deferred<QuantityReadResult<QuantityStageWorkspace>>()
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(envelope('project-b', 'b-1')).mockResolvedValueOnce(envelope('project-b'))
    const state = createQuantityStageState({ read, context: async () => context, execute: vi.fn() })
    const old = state.load(query)
    await state.load({ ...query, projectId: 'project-b' })
    first.resolve(envelope())
    await old
    expect(state.workspace.value?.projectId).toBe('project-b')
    expect(state.baseVersion.value).toBe('b-1')
    await expect(state.load(query)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    expect(state.workspace.value).toBeNull()
    expect(state.canWrite.value).toBe(false)
  })

  it('失败后改稿另建命令，冲突保留当前编辑基线；只读和演示来源不能提交', async () => {
    const execute = vi.fn().mockRejectedValue(quantityProblem('stale-source', '版本冲突'))
    const read = vi.fn().mockResolvedValue(envelope())
    const state = createQuantityStageState({ read, context: async () => context, execute })
    await state.load(query)
    await expect(state.execute(action)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    await expect(state.execute({ ...action, draft: { ...action.draft, name: '更正名称' } })).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    expect(execute.mock.calls[0]![0].commandId).not.toBe(execute.mock.calls[1]![0].commandId)
    expect(state.baseVersion.value).toBe('version-1')
    expect(read).toHaveBeenCalledTimes(1)
    read.mockResolvedValue({ ...envelope(), capabilities: ['quantity:read'] })
    await state.load(query)
    await expect(state.execute(action)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    read.mockResolvedValue({ ...envelope(), dataOrigin: 'demo' })
    await state.load({ ...query, origin: 'demo', includeDemo: true })
    await expect(state.execute(action)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('离开后旧提交成功不覆盖另一项目的版本和保存状态', async () => {
    const result = deferred<{ commandId: string, id: string, logIds: string[], sourceVersion: string }>()
    const read = vi.fn().mockResolvedValueOnce(envelope()).mockResolvedValueOnce(envelope('project-b', 'b-1'))
    const state = createQuantityStageState({ read, context: async () => context, execute: () => result.promise })
    await state.load(query)
    const old = state.execute(action)
    await state.load({ ...query, projectId: 'project-b' })
    result.resolve({ commandId: 'old', id: 'old', logIds: [], sourceVersion: 'a-2' })
    expect(await old).toBeNull()
    expect(state.baseVersion.value).toBe('b-1')
    expect(state.saving.value).toBe(false)
  })

  it('保留草稿时重新核权不更换编辑版本，早先核权迟到不能恢复已撤权限', async () => {
    const delayed = deferred<typeof context>()
    const identity = vi.fn().mockResolvedValueOnce(context).mockReturnValueOnce(delayed.promise).mockResolvedValueOnce({ ...context, capabilities: ['quantity:read'] })
    const state = createQuantityStageState({ read: async () => envelope(), context: identity, execute: vi.fn() })
    await state.load(query)
    const old = state.revalidate()
    expect(await state.revalidate()).toBe(true)
    delayed.resolve(context)
    expect(await old).toBe(false)
    expect(state.canWrite.value).toBe(false)
    expect(state.baseVersion.value).toBe('version-1')
  })

  it('核权失败暂时禁写，重试成功清除旧错误并保留原编辑版本', async () => {
    const identity = vi.fn().mockResolvedValueOnce(context).mockRejectedValueOnce(quantityProblem('unavailable', '核权暂不可用')).mockResolvedValueOnce(context)
    const state = createQuantityStageState({ read: async () => envelope(), context: identity, execute: vi.fn() })
    await state.load(query)
    await expect(state.revalidate()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(state.canWrite.value).toBe(false)
    await state.revalidate()
    expect(state.problem.value).toBeNull()
    expect(state.canWrite.value).toBe(true)
    expect(state.baseVersion.value).toBe('version-1')
  })
})
