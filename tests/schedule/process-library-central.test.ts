import type { ProcessLibraryCreateCommand } from '~/lib/schedule/process-library-contract'
import { describe, expect, it } from 'vitest'
import { createProcessLibraryService } from '../../server/utils/process-library-service'

const session = { workspaceId: 'workspace-443', actorId: 'actor-443', capabilities: ['process-library:read', 'process-library:write', 'demo:read'] }
function command(patch: Partial<ProcessLibraryCreateCommand> = {}): ProcessLibraryCreateCommand {
  return {
    action: 'create-version',
    commandId: 'command-1',
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 0,
    sourceVersion: null,
    draft: { sourceLibraryId: null, code: 'interior', name: '室内工序', description: '', tasks: [
      { key: 'first', name: '第一道', durationDays: 3, trade: '木工', color: '#64748b', stageCode: 'CEILING', itemCodes: ['CEILING'], predecessorKey: null },
      { key: 'second', name: '第二道', durationDays: 2, trade: '木工', color: '#64748b', stageCode: '', itemCodes: [], predecessorKey: 'first' },
    ] },
    ...patch,
  }
}

describe('工序库中央不可变版本', () => {
  it('新编码生成 v1，基于任意旧版产生下一版，旧身份和内容始终不变', () => {
    const service = createProcessLibraryService()
    const first = service.execute(command(), session)
    const original = service.detail(first.id, 'real', session)
    const nextCommand = command({ commandId: 'command-2', baseVersion: 1, sourceVersion: original.sourceVersion, draft: { ...command().draft, sourceLibraryId: first.id, description: '第二版' } })
    const second = service.execute(nextCommand, session)
    const third = service.execute({ ...nextCommand, commandId: 'command-3', baseVersion: 2, draft: { ...nextCommand.draft, description: '仍从第一版复制' } }, session)
    expect([first.version, second.version, third.version]).toEqual([1, 2, 3])
    expect(service.detail(first.id, 'real', session)).toEqual(original)
    expect(service.catalog('real', session).libraries).toHaveLength(3)
    expect(service.catalog('real', session).libraries.every(row => row.usageCount === null)).toBe(true)
  })

  it('同键重试得到同一结果，不同内容复用同键和陈旧同编码提交明确冲突', () => {
    const service = createProcessLibraryService()
    const first = service.execute(command(), session)
    expect(service.execute(command(), session)).toEqual(first)
    expect(() => service.execute(command({ draft: { ...command().draft, name: '另一份内容' } }), session)).toThrow(/冲突|重复/)
    expect(() => service.execute(command({ commandId: 'concurrent' }), session)).toThrow(/版本/)
    expect(service.catalog('real', session).libraries).toHaveLength(1)
  })

  it('无权、伪造操作者、演示写入与跨来源读取均不能泄露或改写正式版本', () => {
    const service = createProcessLibraryService()
    const first = service.execute(command(), session, 'test-a')
    expect(() => service.execute(command({ commandId: 'forged', actorId: 'other' }), session)).toThrow(/身份|会话/)
    expect(() => service.execute(command(), { ...session, capabilities: ['process-library:read'] })).toThrow(/权限/)
    expect(() => service.execute(command({ origin: 'demo' }), session)).toThrow(/演示|来源/)
    expect(() => service.detail(first.id, 'demo', session, 'test-a')).toThrow(/不存在/)
    expect(() => service.detail(first.id, 'real', session, 'test-b')).toThrow(/不存在/)
    expect(() => service.catalog('real', { ...session, capabilities: [] }, 'test-a')).toThrow(/权限/)
  })

  it('版本建立失败不留下头或半份工序，之后同一命令可安全重试', () => {
    let fail = true
    const service = createProcessLibraryService({ beforeCommit: () => {
      if (fail)
        throw new Error('模拟提交失败')
    } })
    expect(() => service.execute(command(), session)).toThrow('模拟提交失败')
    expect(service.catalog('real', session).libraries).toHaveLength(0)
    fail = false
    expect(service.execute(command(), session).version).toBe(1)
  })
})
