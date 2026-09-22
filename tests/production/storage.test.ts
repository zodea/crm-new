import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'

it('磁盘权威事务提交后冷打开保留原值，失败事务不留下半份结果', async () => {
  const base = resolve('.codex-tmp/issue-450-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/storage-`)
  const options = { directory, workspaceId: 'isolated-workspace', ownerId: 'isolated-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  await storage.withTransaction(async (tx) => {
    await tx.execute('CREATE TABLE specimen(id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    await tx.execute('INSERT INTO specimen VALUES(?,?)', ['first', '已可靠提交'])
  })
  await expect(storage.withTransaction(async (tx) => {
    await tx.execute('INSERT INTO specimen VALUES(?,?)', ['second', '不应留下'])
    throw new Error('提交前中断')
  })).rejects.toThrow('提交前中断')
  await storage.close()
  const reopened = createProductionStorage(options)
  try {
    expect(await reopened.select('SELECT * FROM specimen ORDER BY id')).toEqual([{ id: 'first', value: '已可靠提交' }])
    expect((await reopened.status()).participants).toContain('customer')
  }
  finally { await reopened.close() }
})
