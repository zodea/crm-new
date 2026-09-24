import type { QuantityContext } from '~/lib/quantity/central-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'

const context: QuantityContext = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['quantity:read', 'quantity:write', 'project:list:read'] }
const query = { projectId: 'project-central', origin: 'real' as const, includeDemo: false }
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0))
    await close()
})

describe('工程量中央 SQL 测试实例', () => {
  it('真实服务实例隔离测试会话，动态使用当前项目源并能重置', async () => {
    let name = '当前项目'
    const instance = createQuantityTestInstance({
      session: () => context,
      projects: () => [{ id: query.projectId, name, code: 'P-CENTRAL', dataOrigin: 'real' }],
    })
    cleanups.push(() => instance.close())
    const before = await instance.region(query, 'session-a')
    const command = { ...context, requiredCapability: 'quantity:write' as const, commandId: 'create-building', baseVersion: before.sourceVersion, origin: 'real' as const, projectId: query.projectId, action: { kind: 'create-building' as const, draft: { code: 'B1', name: '1栋' } } }
    const pending = instance.execute(command, 'session-a')
    command.action.draft.name = '随后输入'
    const result = await pending
    expect((await instance.region(query, 'session-a')).data.buildings[0]?.id).toBe(result.id)
    expect((await instance.region(query, 'session-a')).data.buildings[0]?.name).toBe('1栋')
    expect((await instance.region(query, 'session-b')).data.buildings).toEqual([])
    name = '中央更名'
    expect((await instance.region(query, 'session-a')).data.projectName).toBe(name)
    await instance.reset('session-a')
    expect((await instance.region(query, 'session-a')).data.buildings).toEqual([])
  })

  it('相同ID的演示项目不能冒充正式父源，当前权限收回后停止读取旧工程量', async () => {
    let allowed = true
    const instance = createQuantityTestInstance({
      session: () => ({ ...context, capabilities: allowed ? context.capabilities : [] }),
      projects: () => [{ id: query.projectId, name: '演示项目', code: 'DEMO', dataOrigin: 'demo' }],
    })
    cleanups.push(() => instance.close())
    await expect(instance.region(query, 'session-a')).rejects.toMatchObject({ problem: { code: 'not-found' } })
    allowed = false
    await expect(instance.region(query, 'session-a')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })
})
