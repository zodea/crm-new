import { mkdir, mkdtemp } from 'node:fs/promises'
import { afterAll, expect, it } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('结构化克隆的真实零字节仍是BLOB，非空字节与SQL NULL互不混同且冷开保持原类型', async () => {
  const base = testTempRoot('opt02-storage-byte-binding')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/original-bytes-`)
  const options = { directory, workspaceId: 'byte-binding-workspace', ownerId: 'byte-binding-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  try {
    await storage.withTransaction(async (tx) => {
      await tx.execute('CREATE TABLE byte_probe(id TEXT PRIMARY KEY,body BLOB)')
      await tx.execute('INSERT INTO byte_probe VALUES(?,?)', ['empty', structuredClone(new Uint8Array())])
      await tx.execute('INSERT INTO byte_probe VALUES(?,?)', ['original', structuredClone(new Uint8Array([0, 255]))])
      await tx.execute('INSERT INTO byte_probe VALUES(?,?)', ['unknown', null])
    })
    const expected = [{ id: 'empty', type: 'blob', length: 0, bytes: '' }, { id: 'original', type: 'blob', length: 2, bytes: '00FF' }, { id: 'unknown', type: 'null', length: null, bytes: '' }]
    expect(await storage.select('SELECT id,typeof(body) AS type,length(body) AS length,hex(body) AS bytes FROM byte_probe ORDER BY id')).toEqual(expected)
    expect(await storage.select('SELECT id FROM byte_probe WHERE body=?', [structuredClone(new Uint8Array())])).toEqual([{ id: 'empty' }])
    await storage.close()
    expect(await storage.select('SELECT id,typeof(body) AS type,length(body) AS length,hex(body) AS bytes FROM byte_probe ORDER BY id')).toEqual(expected)
  }
  finally { await storage.close() }
})

it('磁盘权威事务提交后冷打开保留原值，失败事务不留下半份结果', async () => {
  const base = testTempRoot('legacy-test-artifacts/issue-450-tests')
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
