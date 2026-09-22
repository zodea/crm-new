import type { SQLInputValue } from 'node:sqlite'
import type { DbDriver } from '../../app/lib/db/coordinator'
import { constants } from 'node:fs'
import { access, lstat, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { backup, DatabaseSync } from 'node:sqlite'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { PRODUCTION_PARTICIPANTS, PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, PRODUCTION_STORAGE_VERSION, productionParticipantVersions } from './production-storage-schema'

export interface ProductionStorageOptions {
  directory: string
  workspaceId: string
  ownerId: string
  purpose: 'verification' | 'production'
}
export class ProductionStorageProblem extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionStorageProblem'
  }
}
function invalid(message: string): never {
  throw new ProductionStorageProblem(message)
}
const identity = (value: string) => /^[a-z0-9][\w-]{2,79}$/i.test(value)
const samePath = (left: string, right: string) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right

function metadataVersion(db: DatabaseSync, options: ProductionStorageOptions): number {
  const meta = db.prepare('SELECT * FROM production_metadata WHERE singleton=1').get()
  if (!meta || typeof meta.schema_version !== 'number' || !Number.isSafeInteger(meta.schema_version) || meta.schema_version < 1 || meta.schema_version > PRODUCTION_STORAGE_VERSION)
    invalid('正式数据库版本不兼容；请使用匹配发布物或经验证的恢复流程。')
  if (meta.workspace_id !== options.workspaceId || meta.owner_id !== options.ownerId || meta.purpose !== options.purpose)
    invalid('数据库身份或用途与配置不一致；隔离验证不能接管正式数据。')
  return meta.schema_version
}

function verifyParticipants(db: DatabaseSync, version: number) {
  const expected = productionParticipantVersions(version)
  const actual = db.prepare('SELECT domain,schema_version FROM production_participants').all()
  if (actual.length !== Object.keys(expected).length || actual.some(row => typeof row.domain !== 'string' || expected[row.domain] !== row.schema_version))
    invalid('正式数据库参与者清单或领域版本不兼容；不能把缺少的领域当作空库。')
}

async function backupTo(db: DatabaseSync, source: string, destination: string): Promise<void> {
  if (!isAbsolute(destination) || destination.startsWith('\\\\'))
    invalid('一致备份必须先写入已存在的本机绝对目录。')
  const path = resolve(destination)
  if (samePath(path, source))
    invalid('备份目标不能是活动原库。')
  const parent = dirname(path)
  try {
    const stat = await lstat(parent)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(parent), parent))
      invalid('备份目标父目录不能是链接或重定向目录。')
  }
  catch (cause) {
    if (cause instanceof ProductionStorageProblem)
      throw cause
    invalid('备份目标父目录缺失或无法核对。')
  }
  let reserved: Awaited<ReturnType<typeof open>>
  try {
    reserved = await open(path, 'wx', 0o600)
  }
  catch (cause) {
    invalid((cause as NodeJS.ErrnoException).code === 'EEXIST' ? '备份目标已有文件，不能覆盖。' : '无法建立新的本机备份文件。')
  }
  try {
    // The new file is exclusively reserved by this call. Node's backup API otherwise overwrites a target.
    await backup(db, path)
    const [current, owned] = await Promise.all([lstat(path), reserved.stat()])
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino)
      invalid('备份目标身份发生变化；不能发布为有效副本。')
    await reserved.sync()
  }
  finally {
    // Failed artifacts remain for the backup owner to classify; existing files are never removed here.
    await reserved.close()
  }
}

async function openDriver(options: ProductionStorageOptions): Promise<DbDriver> {
  if (process.versions.node !== '24.12.0')
    invalid('正式存储必须使用已验证的 Node 24.12.0；升级前先验证备份副本。')
  if (!identity(options.workspaceId) || !identity(options.ownerId) || !['verification', 'production'].includes(options.purpose))
    invalid('正式存储缺少固定工作区、维护人身份或用途。')
  if (!isAbsolute(options.directory) || options.directory.startsWith('\\\\'))
    invalid('请配置已存在的本机绝对数据目录；活动库不能放在网络共享。')
  const directory = resolve(options.directory)
  try {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await realpath(directory), directory))
      invalid('数据目录不能是链接或重定向目录。')
    await access(directory, constants.R_OK | constants.W_OK)
  }
  catch (cause) {
    if (cause instanceof ProductionStorageProblem)
      throw cause
    invalid('正式数据目录缺失或不可读写；不会创建空内存替代。')
  }
  const path = join(directory, 'ruihang.sqlite')
  let existed = false
  try {
    const stat = await lstat(path)
    existed = true
    if (!stat.isFile() || stat.isSymbolicLink())
      invalid('正式数据库路径不是普通磁盘文件。')
    await access(path, constants.R_OK | constants.W_OK)
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      invalid('正式数据库不可读写；已有文件不会被替换。')
  }
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(path, { timeout: 5000, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false, defensive: true })
    if (existed) {
      verifyParticipants(db, metadataVersion(db, options))
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
        invalid('正式数据库完整性检查失败；停止写入并核对备份。')
    }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!existed) {
        db.exec(PRODUCTION_STORAGE_SCHEMA)
        db.prepare('INSERT INTO production_metadata VALUES (1,?,?,?,?,?)').run(1, options.workspaceId, options.ownerId, options.purpose, new Date().toISOString())
      }
      let version = metadataVersion(db, options)
      verifyParticipants(db, version)
      for (const upgrade of PRODUCTION_STORAGE_UPGRADES) {
        if (upgrade.to <= version)
          continue
        if (upgrade.from !== version)
          invalid('正式数据库缺少连续升级步骤；停止写入。')
        db.exec(upgrade.sql)
        verifyParticipants(db, upgrade.to)
        db.prepare('UPDATE production_metadata SET schema_version=? WHERE singleton=1').run(upgrade.to)
        version = upgrade.to
      }
      if (version !== PRODUCTION_STORAGE_VERSION)
        invalid('正式数据库尚未达到此发布物要求的版本。')
      // The write lock and an actual write probe are required even for an existing file.
      db.prepare('UPDATE production_metadata SET schema_version=schema_version WHERE singleton=1').run()
      db.exec('COMMIT')
    }
    catch (cause) {
      db.exec('ROLLBACK')
      throw cause
    }
    const connection = db
    return {
      async execute(sql, params) {
        if (sql === 'BEGIN')
          connection.exec('BEGIN IMMEDIATE')
        else if (params)
          connection.prepare(sql).run(...params as SQLInputValue[])
        else connection.exec(sql)
      },
      async select<T>(sql: string, params: unknown[] = []) { return connection.prepare(sql).all(...params as SQLInputValue[]) as T[] },
      backupTo: destination => backupTo(connection, path, destination),
      async close() { connection.close() },
    }
  }
  catch (cause) {
    db?.close()
    if (cause instanceof ProductionStorageProblem)
      throw cause
    invalid('正式数据库无法初始化或读取；停止服务，不回落测试实例。')
  }
}

/** One driver, one transaction queue, one disk authority for this process. */
export function createProductionStorage(options: ProductionStorageOptions) {
  const coordinator = createDbCoordinator(() => openDriver(options))
  return {
    ...coordinator,
    identity: Object.freeze({ workspaceId: options.workspaceId, actorId: options.ownerId }),
    assertBusinessWrite() {
      if (options.purpose !== 'verification')
        invalid('首次正式写入尚未通过独立介质备份及上线门禁；请先完成 PG-02 与上线验收。')
    },
    async status() {
      await coordinator.getDb()
      return { schemaVersion: PRODUCTION_STORAGE_VERSION, purpose: options.purpose, participants: [...PRODUCTION_PARTICIPANTS], writeState: options.purpose === 'verification' ? 'isolated-verification' : 'awaiting-backup-approval' }
    },
  }
}
export type ProductionStorage = ReturnType<typeof createProductionStorage>
