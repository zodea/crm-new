import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'

it('一致备份保留已提交事实并拒绝覆盖已有目标，原库和副本能独立读取', async () => {
  const base = resolve('.tmp/legacy-test-artifacts/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/backup-source-`)
  const destination = await mkdtemp(`${base}/backup-target-`)
  const identity = { workspaceId: 'backup-workspace', ownerId: 'backup-owner', purpose: 'verification' as const }
  const source = createProductionStorage({ ...identity, directory })
  let target: ReturnType<typeof createProductionStorage> | null = null
  try {
    await source.withTransaction(async (tx) => {
      await tx.execute('CREATE TABLE specimen(id TEXT PRIMARY KEY, value TEXT NOT NULL)')
      await tx.execute('INSERT INTO specimen VALUES(?,?)', ['first', '备份时已有事实'])
    })
    await source.backupTo(join(destination, 'ruihang.sqlite'))
    await source.execute('INSERT INTO specimen VALUES(?,?)', ['later', '备份后的新事实'])
    await expect(source.backupTo(join(destination, 'ruihang.sqlite'))).rejects.toThrow('已有')
    await expect(source.backupTo(join(directory, 'ruihang.sqlite'))).rejects.toThrow('原库')
    target = createProductionStorage({ ...identity, directory: destination })
    expect(await target.select('SELECT * FROM specimen')).toEqual([{ id: 'first', value: '备份时已有事实' }])
    expect(await source.select('SELECT id FROM specimen ORDER BY id')).toEqual([{ id: 'first' }, { id: 'later' }])
  }
  finally {
    await target?.close()
    await source.close()
  }
})

it('备份在前一事务提交后执行，后续写入和关闭均等待备份完成', async () => {
  const base = resolve('.tmp/legacy-test-artifacts/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/queued-source-`)
  const destination = await mkdtemp(`${base}/queued-target-`)
  const identity = { workspaceId: 'queued-workspace', ownerId: 'queued-owner', purpose: 'verification' as const }
  const source = createProductionStorage({ ...identity, directory })
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(resolve => release = resolve)
  const ready = new Promise<void>(resolve => started = resolve)
  const transaction = source.withTransaction(async (tx) => {
    await tx.execute('CREATE TABLE specimen(id TEXT PRIMARY KEY)')
    await tx.execute('INSERT INTO specimen VALUES(?)', ['committed-before-backup'])
    started()
    await gate
  })
  await ready
  const backup = source.backupTo(join(destination, 'ruihang.sqlite'))
  const later = source.execute('INSERT INTO specimen VALUES(?)', ['committed-after-backup'])
  const closed = source.close()
  release()
  await Promise.all([transaction, backup, later, closed])
  const target = createProductionStorage({ ...identity, directory: destination })
  const reopened = createProductionStorage({ ...identity, directory })
  try {
    expect(await target.select('SELECT id FROM specimen')).toEqual([{ id: 'committed-before-backup' }])
    expect(await reopened.select('SELECT id FROM specimen ORDER BY id')).toEqual([{ id: 'committed-after-backup' }, { id: 'committed-before-backup' }])
    await expect(reopened.backupTo(join(directory, 'missing', 'backup.sqlite'))).rejects.toThrow('父目录')
    expect(await reopened.select('SELECT count(*) AS total FROM specimen')).toEqual([{ total: 2 }])
  }
  finally {
    await target.close()
    await reopened.close()
  }
})
