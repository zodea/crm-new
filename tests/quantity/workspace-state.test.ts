import { describe, expect, it, vi } from 'vitest'
import { quantityProblem } from '~/lib/quantity/central-contract'
import { createQuantityWorkspaceRecovery } from '~/lib/quantity/command-recovery'
import { createQuantityWorkspaceState } from '~/lib/quantity/workspace-state'

const identity = { workspaceId: 'w', actorId: 'a', capabilities: ['quantity:read', 'quantity:write'] }
const query = { projectId: 'project', unitId: 'unit-a', origin: 'real' as const, includeDemo: false }
const response = (unitId: string, sourceVersion = 'v1', origin: 'real' | 'demo' = 'real') => ({ data: { projectId: 'project', unitId }, sourceVersion, dataOrigin: origin, capabilities: identity.capabilities, asOf: '2026-09-11T00:00:00Z' })

describe('工程量工作面独立编辑会话', () => {
  it('同项目切户撤销旧事实，迟到响应不能覆盖新户；保存使用该工作面原读取版本', async () => {
    let finish!: (value: ReturnType<typeof response>) => void
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => finish = resolve)).mockResolvedValue(response('unit-b', 'v7'))
    const execute = vi.fn().mockRejectedValueOnce(quantityProblem('unavailable', '中断')).mockResolvedValue({ commandId: 'same', id: 'saved', logIds: [], sourceVersion: 'v8' })
    const state = createQuantityWorkspaceState({ read, context: async () => identity, execute })
    const earlier = state.load(query)
    await state.load({ ...query, unitId: 'unit-b' })
    finish(response('unit-a'))
    await earlier
    expect(state.workspace.value).toMatchObject({ unitId: 'unit-b' })
    const action = { kind: 'set-archived' as const, archived: true }
    await expect(state.execute(action)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await state.execute(action)
    expect(execute.mock.calls.map(call => call[0].baseVersion)).toEqual(['v7', 'v7'])
    expect(execute.mock.calls[0]![0].commandId).toBe(execute.mock.calls[1]![0].commandId)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('同ID切演示先清空正式资料，来源错配和读取失败均不能恢复正式写入口', async () => {
    const read = vi.fn().mockResolvedValue(response('unit-a'))
    const execute = vi.fn()
    const state = createQuantityWorkspaceState({ read, context: async () => identity, execute })
    await state.load(query)
    const pending = state.load({ ...query, origin: 'demo' as const, includeDemo: true })
    expect(state.workspace.value).toBeNull()
    expect(state.canWrite.value).toBe(false)
    await expect(pending).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(state.execute({ kind: 'set-archived', archived: false })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(execute).not.toHaveBeenCalled()
  })
})

it('正式结果未知与保存后读取失败保原定位，刷新只resolve原号；另一户和权限变化不能清掉它', async () => {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
    clear: () => values.clear(),
  }
  let currentIdentity = identity
  let failRead = false
  const read = vi.fn(async (requested: typeof query) => {
    if (failRead)
      throw quantityProblem('unavailable', '保存后的读取失败')
    return response(requested.unitId)
  })
  const execute = vi.fn().mockRejectedValue(quantityProblem('unavailable', '结果未知'))
  const resolve = vi.fn().mockImplementation(async descriptor => ({ outcome: 'applied', result: { commandId: descriptor.commandId, id: 'saved', logIds: [], sourceVersion: 'v2' } }))
  const create = () => createQuantityWorkspaceState({ context: async () => currentIdentity, read, execute, recovery: createQuantityWorkspaceRecovery('completion', () => true, resolve, () => storage) })
  let state = create()
  await state.load(query)
  const action = { kind: 'save-completion' as const, draft: { projectId: 'project', unitId: 'unit-a', stageId: 'stage', status: 'draft' as const, completedAt: null, note: '未持久字段原输入', photos: [], expectedAssignmentId: null, expectedCompletionId: null, expectedCompletionFingerprint: null } }
  await expect(state.execute(action)).rejects.toThrow('结果未知')
  const original = state.pendingOperations.value[0]!
  expect(JSON.stringify([...values.values()])).not.toContain(action.draft.note)
  await expect(state.execute({ ...action, draft: { ...action.draft, note: '不能替换原请求' } })).rejects.toThrow('原工程量提交')
  state = create()
  await state.load({ ...query, unitId: 'unit-b' })
  expect(state.pendingOperations.value).toEqual([])
  await state.load(query)
  expect(state.pendingOperations.value).toEqual([original])
  currentIdentity = { ...identity, actorId: 'different' }
  await expect(state.recover(original)).rejects.toThrow('身份')
  expect(resolve).not.toHaveBeenCalled()
  currentIdentity = identity
  failRead = true
  await expect(state.recover(original)).rejects.toThrow('读取失败')
  expect(values.size).toBe(1)
  failRead = false
  await state.recover(original)
  expect(resolve.mock.calls.map(row => row[0])).toEqual([original, original])
  expect(values.size).toBe(0)
  expect(state.canWrite.value).toBe(true)
})
