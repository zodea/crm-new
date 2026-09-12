import { describe, expect, it, vi } from 'vitest'
import { quantityProblem } from '~/lib/quantity/central-contract'
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
