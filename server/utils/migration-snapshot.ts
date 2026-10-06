import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ProblemDTO } from '../../app/types/read-model'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'

export class MigrationEvidenceProblem extends Error {
  readonly problem: ProblemDTO
  constructor(code: ProblemDTO['code'], message: string) {
    super(message)
    this.name = 'MigrationEvidenceProblem'
    this.problem = { code, message, retryable: false, fieldErrors: {}, traceId: null }
  }
}
function fail(message: string): never {
  throw new MigrationEvidenceProblem('validation-failed', message)
}
let runtime: ReturnType<typeof initSqlJs> | null = null

/**
 * Reads the supplied complete SQLite bytes, rather than trusting a client graph or hash.
 * Callers authorize before opening. The source is never migrated, seeded or persisted.
 * Only the owning domain's frozen graph and original bytes enter the business database.
 */
export async function withVerifiedMigrationSnapshot<T>(
  source: { sha256: string, payloadBase64: string },
  read: (tx: TransactionDb, evidence: { sha256: string, schemaVersion: number }) => Promise<T>,
): Promise<T> {
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).sort().join(',') !== 'payloadBase64,sha256'
    || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || typeof source.payloadBase64 !== 'string' || !source.payloadBase64.length || source.payloadBase64.length % 4 !== 0
    || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(source.payloadBase64)) {
    return fail('迁入来源必须提供完整 SQLite 字节及其 SHA-256。')
  }
  const bytes = Buffer.from(source.payloadBase64, 'base64')
  if (bytes.toString('base64') !== source.payloadBase64 || bytes.length < 100 || bytes.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0'
    || createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    return fail('迁入来源字节、完整 SQLite 标识或实际摘要不一致；请保留原库。')
  }
  if (!runtime) {
    const pending = initSqlJs({ locateFile: () => createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm') })
    runtime = pending
    void pending.catch(() => {
      if (runtime === pending)
        runtime = null
    })
  }
  const SQL = await runtime
  let db
  try {
    db = new SQL.Database(bytes)
  }
  catch { return fail('迁入来源无法作为完整 SQLite 只读打开；请保留原库。') }
  const tx: TransactionDb = {
    async execute() { return fail('来源快照只允许核验，不能修改、升级或写入。') },
    async select<R>(sql: string, params: unknown[] = []): Promise<R[]> {
      const statement = db.prepare(sql)
      try {
        statement.bind(params as never[])
        const rows: R[] = []
        while (statement.step())
          rows.push(statement.getAsObject() as R)
        return rows
      }
      finally { statement.free() }
    },
  }
  try {
    db.run('PRAGMA query_only=ON')
    const integrity = await tx.select<Record<string, unknown>>('PRAGMA integrity_check')
    if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok')
      return fail('迁入来源没有通过 SQLite 完整性核验。')
    if ((await tx.select('PRAGMA foreign_key_check')).length)
      return fail('迁入来源存在失效外键，不能静默遗漏或生成替代身份。')
    const schemaVersion = (await tx.select<{ version: unknown }>('SELECT MAX(version) AS version FROM schema_migrations'))[0]?.version
    if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
      return fail('迁入来源缺少真实、可核验的 schema 版本。')
    return await read(tx, { sha256: source.sha256, schemaVersion })
  }
  finally { db.close() }
}
