import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture() {
  const base = testTempRoot('legacy-test-artifacts/issue-450-tests')
  await mkdir(base, { recursive: true })
  return { directory: await mkdtemp(`${base}/boundary-`), workspaceId: 'isolated-workspace', ownerId: 'isolated-owner', purpose: 'verification' as const }
}
it('缺失目录、损坏文件与未知版本停止初始化，不替换已有文件', async () => {
  const config = await fixture()
  await expect(createProductionStorage({ ...config, directory: join(config.directory, 'not-created') }).status()).rejects.toThrow('目录缺失')
  const path = join(config.directory, 'ruihang.sqlite')
  await writeFile(path, 'intentional-corrupt-synthetic-database')
  const corruptBytes = await readFile(path)
  await expect(createProductionStorage(config).status()).rejects.toThrow('无法初始化或读取')
  expect(await readFile(path)).toEqual(corruptBytes)
  const newer = await fixture()
  const first = createProductionStorage(newer)
  await first.status()
  await first.close()
  const raw = new DatabaseSync(join(newer.directory, 'ruihang.sqlite'))
  raw.exec('UPDATE production_metadata SET schema_version=9000')
  raw.close()
  await expect(createProductionStorage(newer).status()).rejects.toThrow('版本不兼容')
  const unchanged = new DatabaseSync(join(newer.directory, 'ruihang.sqlite'), { readOnly: true })
  try {
    expect(unchanged.prepare('SELECT schema_version FROM production_metadata').get()).toMatchObject({ schema_version: 9000 })
  }
  finally { unchanged.close() }
})
it('只读文件、改变身份/用途都停止写入；生产用途未过备份门禁不开放业务写入', async () => {
  const config = await fixture()
  const first = createProductionStorage(config)
  await first.status()
  await first.close()
  await expect(createProductionStorage({ ...config, ownerId: 'another-owner' }).status()).rejects.toThrow('身份或用途')
  await expect(createProductionStorage({ ...config, purpose: 'production' }).status()).rejects.toThrow('身份或用途')
  const path = join(config.directory, 'ruihang.sqlite')
  const originalBytes = await readFile(path)
  const readOnly = createProductionStorage(config)
  let opened = false
  await chmod(path, 0o444)
  try {
    const status = readOnly.status().then((value) => {
      opened = true
      return value
    })
    await expect(status).rejects.toThrow('正式数据库不可读写；已有文件不会被替换。')
  }
  finally {
    try {
      if (opened)
        await readOnly.close()
    }
    finally { await chmod(path, 0o666) }
  }
  expect(await readFile(path)).toEqual(originalBytes)
  const reopened = createProductionStorage(config)
  try {
    expect((await reopened.status()).purpose).toBe('verification')
  }
  finally { await reopened.close() }
  const production = createProductionStorage({ ...await fixture(), purpose: 'production' })
  try {
    expect((await production.status()).writeState).toBe('awaiting-backup-approval')
    expect(() => production.assertBusinessWrite()).toThrow('备份及上线门禁')
  }
  finally { await production.close() }
})
