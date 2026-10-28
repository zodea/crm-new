import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { backupFileDigest, inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { copyBackupPackage, createLocalBackup, readBackupPackage, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('真实独立副本与离线复制保留数据时间，隔离恢复不覆盖活动库，损坏复制不替换上份', async () => {
  const base = testTempRoot('opt02-backup-tests')
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
    expect((await readFile(join(locations.nas!, id, 'data.sqlite'))).equals(successful)).toBe(true)
    expect(await readBackupPackage(locations.nas!, id)).toEqual(local)
  }
  finally { await storage.close() }
})

async function longPathRoot() {
  const base = testTempRoot('a02-clearance-tests')
  await mkdir(base, { recursive: true })
  return mkdtemp(join(base, 'backup-long-lifecycle-'))
}

async function longDirectory(root: string, name: string) {
  let path = join(root, name)
  while (join(path, 'ruihang.sqlite').length <= 280)
    path = join(path, '中文完整备份与冷恢复原件审计')
  await mkdir(path, { recursive: true })
  expect(join(path, 'ruihang.sqlite').length).toBeGreaterThan(260)
  return path
}

async function savedLongPathCustomer(storage: ReturnType<typeof createProductionStorage>) {
  const session = () => ({ ...storage.identity, capabilities: ['customer:write', 'customer:list:read', 'customer:original:write', 'customer:original:read'] })
  const bytes = Buffer.from('长路径合成原件\u0000真实正文')
  const request = { ...storage.identity, commandId: 'long-lifecycle-customer', requiredCapability: 'customer:write', action: 'draft', baseVersion: null, draft: { name: '长路径已提交客户', aliases: [] }, attachments: { add: [{ fileName: '中文原件.txt', fileSize: bytes.length, mimeType: 'text/plain', category: '合同', contentBase64: bytes.toString('base64') }] } }
  const service = createProductionCustomerService(storage)
  const result = await service.execute(request, session, null)
  return { bytes, request, result, session }
}

it('真实深层中文目录的新库与冷打开保原客户、原件、审计及同键回执，不重复写', async () => {
  const root = await longPathRoot()
  const directory = await longDirectory(root, '实际数据')
  const options = { directory, workspaceId: 'long-storage-workspace', ownerId: 'long-storage-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  let saved
  try {
    saved = await savedLongPathCustomer(storage)
    expect(await storage.select('SELECT id,name,version FROM customers')).toEqual([{ id: saved.result.id, name: '长路径已提交客户', version: 1 }])
  }
  finally { await storage.close() }
  const reopened = createProductionStorage(options)
  try {
    const service = createProductionCustomerService(reopened)
    expect(await service.execute(saved.request, saved.session, null)).toEqual(saved.result)
    expect(await reopened.select('SELECT COUNT(*) AS count FROM customer_command_receipts')).toEqual([{ count: 1 }])
    expect(await reopened.select('SELECT COUNT(*) AS count FROM customer_audits')).toEqual([{ count: 1 }])
    const original = await service.file(saved.result.id, saved.result.attachmentIds[0]!, saved.session)
    expect(Buffer.from(original.bytes)).toEqual(saved.bytes)
  }
  finally { await reopened.close() }
})

it('真实Node一致备份写入中文长目标，不覆盖已有文件并保完整原件与回执', async () => {
  const directory = await longPathRoot()
  const storage = createProductionStorage({ directory, workspaceId: 'long-target-workspace', ownerId: 'long-target-owner', purpose: 'verification' })
  try {
    const saved = await savedLongPathCustomer(storage)
    const path = join(await longDirectory(directory, '一致副本'), 'data.sqlite')
    await storage.backupTo(path)
    const inventory = await inspectProductionBackup(path)
    expect(inventory.originals).toEqual({ files: 1, bytes: saved.bytes.length })
    expect(inventory.tables.customers?.rows).toBe(1)
    expect(inventory.tables.customer_command_receipts?.rows).toBe(1)
    expect(inventory.tables.customer_audits?.rows).toBe(1)
    const digest = await backupFileDigest(path)
    await expect(storage.backupTo(path)).rejects.toThrow('不能覆盖')
    expect(await backupFileDigest(path)).toBe(digest)
  }
  finally { await storage.close() }
})

it('中文长路径备份包完整离线复制与隔离冷恢复，原件回执保真且损坏不覆盖健康副本', async () => {
  const root = await longPathRoot()
  const directory = join(root, 'source')
  await mkdir(directory)
  const identity = { workspaceId: 'long-package-workspace', ownerId: 'long-package-owner', purpose: 'verification' as const }
  const storage = createProductionStorage({ ...identity, directory })
  let restoredStorage: ReturnType<typeof createProductionStorage> | undefined
  try {
    const saved = await savedLongPathCustomer(storage)
    const staging = await longDirectory(root, '独立副本')
    const offline = await longDirectory(root, '离线副本')
    const restore = await longDirectory(root, '隔离恢复')
    const id = `backup-${randomUUID()}`
    const local = await createLocalBackup(storage, staging, id, () => '2026-10-05T00:00:00.000Z')
    expect(local.inventory.originals).toEqual({ files: 1, bytes: saved.bytes.length })
    expect(local.inventory.tables.customer_command_receipts?.rows).toBe(1)
    expect(local.inventory.tables.customer_audits?.rows).toBe(1)
    const sourceDigest = await backupFileDigest(join(staging, id, 'data.sqlite'))
    expect(await copyBackupPackage(staging, offline, id)).toEqual(local)
    expect(await backupFileDigest(join(offline, id, 'data.sqlite'))).toBe(sourceDigest)
    const restored = await restoreBackupIsolated(offline, id, restore, 'cold-check')
    expect(restored.inventory).toEqual(local.inventory)
    expect(await restoreBackupIsolated(offline, id, restore, 'cold-check')).toEqual(restored)
    restoredStorage = createProductionStorage({ ...identity, directory: restored.directory })
    const service = createProductionCustomerService(restoredStorage)
    expect(await service.execute(saved.request, saved.session, null)).toEqual(saved.result)
    const original = await service.file(saved.result.id, saved.result.attachmentIds[0]!, saved.session)
    expect(Buffer.from(original.bytes)).toEqual(saved.bytes)
    expect(await restoredStorage.select('SELECT COUNT(*) AS count FROM customer_command_receipts')).toEqual([{ count: 1 }])
    expect(await restoredStorage.select('SELECT COUNT(*) AS count FROM customer_audits')).toEqual([{ count: 1 }])
    await restoredStorage.close()
    restoredStorage = undefined
    const damaged = `backup-${randomUUID()}`
    await createLocalBackup(storage, staging, damaged, () => '2026-10-05T01:00:00.000Z')
    await writeFile(join(staging, damaged, 'data.sqlite'), '不是数据库')
    await expect(copyBackupPackage(staging, offline, damaged)).rejects.toThrow()
    expect(await readBackupPackage(offline, id)).toEqual(local)
    expect(await backupFileDigest(join(offline, id, 'data.sqlite'))).toBe(sourceDigest)
  }
  finally {
    await restoredStorage?.close()
    await storage.close()
  }
})
