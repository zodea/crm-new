import type { ProductionBackupInventory } from './production-backup-manifest'
import type { ProductionStorage } from './production-storage'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rmdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { backupDigest, backupInvalid, inspectProductionBackup } from './production-backup-manifest'

export interface ProductionBackupPackage {
  format: 'ruihang-backup-v1'
  id: string
  capturedAt: string
  completedAt: string
  inventory: ProductionBackupInventory
}
const validId = (value: string) => /^backup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)
export const backupInventoryDigest = (value: ProductionBackupInventory) => backupDigest(canonical(value))

export async function existingBackupDirectory(path: string): Promise<string> {
  if (!isAbsolute(path))
    backupInvalid('备份位置必须为已配置的绝对目录。')
  const resolved = resolve(path)
  const stat = await lstat(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(resolved), resolved))
    backupInvalid('备份位置不能是链接或重定向目录。')
  return resolved
}

async function syncFile(path: string) {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  }
  finally { await handle.close() }
}

export async function readBackupPackage(root: string, id: string): Promise<ProductionBackupPackage> {
  if (!validId(id))
    backupInvalid('备份编号无效。')
  const directory = await existingBackupDirectory(join(await existingBackupDirectory(root), id))
  const names = (await readdir(directory)).sort()
  if (JSON.stringify(names) !== JSON.stringify(['data.sqlite', 'manifest.json']))
    backupInvalid('备份包不完整或混入未登记文件。')
  const manifestPath = join(directory, 'manifest.json')
  const stat = await lstat(manifestPath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    backupInvalid('备份清单不是有效的普通文件。')
  let value: ProductionBackupPackage
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8'))
  }
  catch { return backupInvalid('备份清单无法读取。') }
  if (!value || value.format !== 'ruihang-backup-v1' || value.id !== id || !value.inventory
    || Object.keys(value).sort().join(',') !== 'capturedAt,completedAt,format,id,inventory'
    || typeof value.capturedAt !== 'string' || typeof value.completedAt !== 'string'
    || !Number.isFinite(Date.parse(value.capturedAt)) || !Number.isFinite(Date.parse(value.completedAt))
    || new Date(value.capturedAt).toISOString() !== value.capturedAt || new Date(value.completedAt).toISOString() !== value.completedAt
    || value.completedAt < value.capturedAt) {
    backupInvalid('备份清单的格式、身份或时间不完整。')
  }
  const actual = await inspectProductionBackup(join(directory, 'data.sqlite'))
  if (backupInventoryDigest(actual) !== backupInventoryDigest(value.inventory))
    backupInvalid('备份清单与数据库、原件或回执不一致。')
  return value
}

export async function createLocalBackup(storage: ProductionStorage, root: string, id: string, now: () => string): Promise<ProductionBackupPackage> {
  if (!validId(id))
    backupInvalid('备份编号无效。')
  const directory = join(await existingBackupDirectory(root), id)
  await mkdir(directory)
  const capturedAt = now()
  const databasePath = join(directory, 'data.sqlite')
  await storage.backupTo(databasePath)
  // Only the new, completed snapshot changes journal mode. The live WAL database is untouched.
  const standalone = new DatabaseSync(databasePath, { defensive: true })
  try {
    if (standalone.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode !== 'delete')
      backupInvalid('一致副本尚不能独立读取。')
  }
  finally { standalone.close() }
  await syncFile(databasePath)
  const inventory = await inspectProductionBackup(databasePath)
  if (inventory.workspaceId !== storage.identity.workspaceId || inventory.ownerId !== storage.identity.actorId)
    backupInvalid('一致副本与当前工作区身份不匹配。')
  const value: ProductionBackupPackage = { format: 'ruihang-backup-v1', id, capturedAt, completedAt: now(), inventory }
  const handle = await open(join(directory, 'manifest.json'), 'wx', 0o600)
  try {
    await handle.writeFile(canonical(value), 'utf8')
    await handle.sync()
  }
  finally { await handle.close() }
  return readBackupPackage(root, id)
}

/** Publish a verified pair under a new identity; never overwrite a prior successful package. */
export async function copyBackupPackage(sourceRoot: string, targetRoot: string, id: string): Promise<ProductionBackupPackage> {
  const source = await existingBackupDirectory(sourceRoot)
  const target = await existingBackupDirectory(targetRoot)
  if (samePath(source, target))
    backupInvalid('副本位置不能与来源相同。')
  const original = await readBackupPackage(source, id)
  try {
    await lstat(join(target, id))
    const previous = await readBackupPackage(target, id)
    if (canonical(previous) !== canonical(original))
      backupInvalid('目标同编号备份与来源不同，不能覆盖。')
    return previous
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      throw cause
  }
  const stagingRoot = join(target, `pending-${id}-${randomUUID()}`)
  await mkdir(stagingRoot)
  const stagingPackage = join(stagingRoot, id)
  await mkdir(stagingPackage)
  for (const name of ['data.sqlite', 'manifest.json']) {
    const destination = join(stagingPackage, name)
    await copyFile(join(source, id, name), destination, constants.COPYFILE_EXCL)
    await syncFile(destination)
  }
  const copied = await readBackupPackage(stagingRoot, id)
  if (canonical(copied) !== canonical(original))
    backupInvalid('复制后的备份身份与来源不一致。')
  try {
    await lstat(join(target, id))
    backupInvalid('目标已有同编号备份，不能覆盖。')
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      throw cause
  }
  await rename(stagingPackage, join(target, id))
  await rmdir(stagingRoot)
  return readBackupPackage(target, id)
}

export async function restoreBackupIsolated(sourceRoot: string, id: string, restoreRoot: string, restoreId: string): Promise<{ inventory: ProductionBackupInventory, directory: string }> {
  if (!/^[a-z0-9][\w-]{2,79}$/i.test(restoreId))
    backupInvalid('恢复验证编号无效。')
  const original = await readBackupPackage(sourceRoot, id)
  const directory = join(await existingBackupDirectory(restoreRoot), restoreId)
  try {
    await lstat(directory)
    await existingBackupDirectory(directory)
    if (JSON.stringify(await readdir(directory)) !== JSON.stringify(['ruihang.sqlite']))
      backupInvalid('隔离恢复目录含未登记文件，不能将其作为恢复证明。')
    const inventory = await inspectProductionBackup(join(directory, 'ruihang.sqlite'))
    if (backupInventoryDigest(inventory) !== backupInventoryDigest(original.inventory))
      backupInvalid('恢复目标已有不同内容，不能覆盖。')
    return { inventory, directory }
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      throw cause
  }
  await mkdir(directory)
  const target = join(directory, 'ruihang.sqlite')
  await copyFile(join(sourceRoot, id, 'data.sqlite'), target, constants.COPYFILE_EXCL)
  await syncFile(target)
  const inventory = await inspectProductionBackup(target)
  if (backupInventoryDigest(inventory) !== backupInventoryDigest(original.inventory))
    backupInvalid('隔离恢复与原备份清单不一致；不会切换活动数据库。')
  return { inventory, directory }
}
