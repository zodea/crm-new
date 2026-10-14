import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createProductionStorage } from '../../server/utils/production-storage'

async function fixture() {
  const base = resolve('.tmp/legacy-test-artifacts/issue-450-tests')
  await mkdir(base, { recursive: true })
  return { directory: await mkdtemp(`${base}/boundary-`), workspaceId: 'isolated-workspace', ownerId: 'isolated-owner', purpose: 'verification' as const }
}
it('缺失目录、损坏文件与未知版本停止初始化，不替换已有文件', async () => {
  const config = await fixture()
  await expect(createProductionStorage({ ...config, directory: join(config.directory, 'not-created') }).status()).rejects.toThrow('目录缺失')
  const path = join(config.directory, 'ruihang.sqlite')
  await writeFile(path, 'intentional-corrupt-synthetic-database')
  await expect(createProductionStorage(config).status()).rejects.toThrow('无法初始化或读取')
  const newer = await fixture()
  const first = createProductionStorage(newer)
  await first.status()
  await first.close()
  const raw = new DatabaseSync(join(newer.directory, 'ruihang.sqlite'))
  raw.exec('UPDATE production_metadata SET schema_version=9000')
  raw.close()
  await expect(createProductionStorage(newer).status()).rejects.toThrow('版本不兼容')
})
it('只读文件、改变身份/用途都停止写入；生产用途未过备份门禁不开放业务写入', async () => {
  const config = await fixture()
  const first = createProductionStorage(config)
  await first.status()
  await first.close()
  await expect(createProductionStorage({ ...config, ownerId: 'another-owner' }).status()).rejects.toThrow('身份或用途')
  await expect(createProductionStorage({ ...config, purpose: 'production' }).status()).rejects.toThrow('身份或用途')
  const path = join(config.directory, 'ruihang.sqlite')
  await chmod(path, 0o444)
  try {
    await expect(createProductionStorage(config).status()).rejects.toThrow()
  }
  finally { await chmod(path, 0o666) }
  const production = createProductionStorage({ ...await fixture(), purpose: 'production' })
  try {
    expect((await production.status()).writeState).toBe('awaiting-backup-approval')
    expect(() => production.assertBusinessWrite()).toThrow('备份及上线门禁')
  }
  finally { await production.close() }
})
