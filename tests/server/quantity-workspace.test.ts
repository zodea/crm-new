import { expect, it, vi } from 'vitest'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'

it('预算工作区事务不要求工程量或项目权限，失败不发布半份SQL', async () => {
  const session = { workspaceId: 'budget-workspace', actorId: 'budget-actor', capabilities: ['target-cost:read', 'target-cost:write'] }
  const instance = createQuantityTestInstance({ session: () => session, projects: () => {
    throw new Error('预算不得借用工程量项目读取')
  } })
  try {
    await instance.withWorkspaceTransaction(async (db, context) => {
      expect(context.capabilities).toEqual(['target-cost:read', 'target-cost:write'])
      await db.execute('INSERT INTO target_costs (id,project_id,name) VALUES (?,NULL,?)', ['draft', '无项目草稿'])
    })
    await expect(instance.withWorkspaceTransaction(async (db) => {
      await db.execute('UPDATE target_costs SET name = ? WHERE id = ?', ['不应保存', 'draft'])
      throw new Error('写入失败')
    })).rejects.toThrow('写入失败')
    expect(await instance.withWorkspaceTransaction(db => db.select('SELECT name,project_id FROM target_costs WHERE id = ?', ['draft']))).toEqual([{ name: '无项目草稿', project_id: null }])
  }
  finally { await instance.close() }
})

it.each(['actor', 'workspace', 'capabilities'] as const)('预算回调提交前再次核对 %s，撤权或切换身份不发布半份写入', async (kind) => {
  const original = { workspaceId: 'guard', actorId: 'actor', capabilities: ['target-cost:write'] }
  let session = structuredClone(original)
  const instance = createQuantityTestInstance({ session: () => session, projects: () => [] })
  try {
    await expect(instance.withWorkspaceTransaction(async (db) => {
      await db.execute('INSERT INTO target_costs(id,name) VALUES (?,?)', ['pending', '未提交预算'])
      if (kind === 'actor')
        session.actorId = 'another'
      if (kind === 'workspace')
        session.workspaceId = 'another'
      if (kind === 'capabilities')
        session.capabilities = []
    })).rejects.toMatchObject({ name: 'WorkspaceTransactionSessionChanged' })
    session = structuredClone(original)
    expect(await instance.withWorkspaceTransaction(db => db.select('SELECT * FROM target_costs'))).toEqual([])
  }
  finally { await instance.close() }
})

it('预算排队期间切换身份，旧命令回调不会开始', async () => {
  const original = { workspaceId: 'queue', actorId: 'actor', capabilities: ['target-cost:write'] }
  let session = structuredClone(original)
  const instance = createQuantityTestInstance({ session: () => session, projects: () => [] })
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const first = instance.withWorkspaceTransaction(async () => {
      entered()
      await held
    })
    await started
    const consume = vi.fn(async () => 'should-not-run')
    const second = instance.withWorkspaceTransaction(consume)
    session.actorId = 'another'
    const assertions = Promise.all([expect(first).rejects.toMatchObject({ name: 'WorkspaceTransactionSessionChanged' }), expect(second).rejects.toMatchObject({ name: 'WorkspaceTransactionSessionChanged' })])
    release()
    await assertions
    expect(consume).not.toHaveBeenCalled()
    session = structuredClone(original)
  }
  finally {
    release()
    await instance.close()
  }
})

it.each(['commit', 'abort'] as const)('迁移候选 %s 前持有同一工作区队列，预算写入等待释放', async (outcome) => {
  const instance = createQuantityTestInstance({ session: () => ({ workspaceId: 'migration-lock', actorId: 'actor', capabilities: ['target-cost:write'] }), projects: () => [] })
  try {
    const candidate = await instance.prepareMigrationSnapshot({ authority: 'local', activeBatchId: null, entities: [] })
    const consume = vi.fn(async () => 'released')
    const write = instance.withWorkspaceTransaction(consume)
    await Promise.resolve()
    expect(consume).not.toHaveBeenCalled()
    await candidate[outcome]()
    expect(await write).toBe('released')
    expect(consume).toHaveBeenCalledTimes(1)
  }
  finally { await instance.close() }
})
