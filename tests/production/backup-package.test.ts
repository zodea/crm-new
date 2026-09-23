import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { copyBackupPackage, createLocalBackup, readBackupPackage, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { createProductionStorage } from '../../server/utils/production-storage'

it('真实独立副本与离线复制保留数据时间，隔离恢复不覆盖活动库，损坏复制不替换上份', async () => {
  const base = resolve('.codex-tmp/issue-451-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/package-`)
  const locations = Object.fromEntries(['source', 'staging', 'nas', 'offline', 'restore'].map(name => [name, join(directory, name)]))
  for (const path of Object.values(locations)) await mkdir(path)
  const identity = { workspaceId: 'package-workspace', ownerId: 'package-owner', purpose: 'verification' as const }
  const storage = createProductionStorage({ ...identity, directory: locations.source! })
  try {
    const id = `backup-${randomUUID()}`
    const local = await createLocalBackup(storage, locations.staging!, id, () => '2026-09-22T00:00:00.000Z')
    expect(await copyBackupPackage(locations.staging!, locations.nas!, id)).toEqual(local)
    expect(await copyBackupPackage(locations.nas!, locations.offline!, id)).toEqual(local)
    expect(await copyBackupPackage(locations.nas!, locations.offline!, id)).toEqual(local)
    const restored = await restoreBackupIsolated(locations.offline!, id, locations.restore!, 'isolated-check')
    expect(restored.inventory).toEqual(local.inventory)
    expect(await restoreBackupIsolated(locations.offline!, id, locations.restore!, 'isolated-check')).toEqual(restored)
    expect((await storage.status()).schemaVersion).toBe(local.inventory.schemaVersion)
    const successful = await readFile(join(locations.nas!, id, 'data.sqlite'))
    const corrupt = `backup-${randomUUID()}`
    await createLocalBackup(storage, locations.staging!, corrupt, () => '2026-09-22T12:00:00.000Z')
    await writeFile(join(locations.staging!, corrupt, 'data.sqlite'), '不是数据库')
    await expect(copyBackupPackage(locations.staging!, locations.nas!, corrupt)).rejects.toThrow()
    expect(await readFile(join(locations.nas!, id, 'data.sqlite'))).toEqual(successful)
    expect(await readBackupPackage(locations.nas!, id)).toEqual(local)
  }
  finally { await storage.close() }
})
