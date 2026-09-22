import type { SQLInputValue } from 'node:sqlite'
import type { DbDriver } from '../../app/lib/db/coordinator'
import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { PRODUCTION_PARTICIPANTS, PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_VERSION } from './production-storage-schema'

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
      const meta = db.prepare('SELECT * FROM production_metadata WHERE singleton=1').get()
      if (!meta || meta.schema_version !== PRODUCTION_STORAGE_VERSION)
        invalid('正式数据库版本不兼容；请使用匹配发布物或经验证的恢复流程。')
      if (meta.workspace_id !== options.workspaceId || meta.owner_id !== options.ownerId || meta.purpose !== options.purpose)
        invalid('数据库身份或用途与配置不一致；隔离验证不能接管正式数据。')
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
        invalid('正式数据库完整性检查失败；停止写入并核对备份。')
    }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!existed) {
        db.exec(PRODUCTION_STORAGE_SCHEMA)
        db.prepare('INSERT INTO production_metadata VALUES (1,?,?,?,?,?)').run(PRODUCTION_STORAGE_VERSION, options.workspaceId, options.ownerId, options.purpose, new Date().toISOString())
      }
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
