import { ALL_SCHEMA, SCHEMA_VERSION } from './schema'

interface DbDriver {
  execute(sql: string, params?: unknown[]): Promise<void>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

let db: DbDriver | null = null

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

async function createTauriDriver(): Promise<DbDriver> {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  const conn = await Database.load('sqlite:crm.db')
  return {
    async execute(sql, params = []) {
      await conn.execute(sql, params as any[])
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return conn.select(sql, params as any[])
    },
    async close() {
      await conn.close()
    },
  }
}

async function createSqlJsDriver(): Promise<DbDriver> {
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs()
  const conn = new SQL.Database()
  return {
    async execute(sql) {
      conn.run(sql)
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = conn.prepare(sql)
      if (params.length) stmt.bind(params as any[])
      const rows: T[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T)
      }
      stmt.free()
      return rows
    },
    async close() {
      conn.close()
    },
  }
}

export async function getDb(): Promise<DbDriver> {
  if (db) return db

  try {
    if (isTauri()) {
      db = await createTauriDriver()
    }
    else {
      db = await createSqlJsDriver()
    }
  }
  catch {
    db = await createSqlJsDriver()
  }

  const stmts = ALL_SCHEMA.split(';').filter(s => s.trim())
  for (const stmt of stmts) {
    await db.execute(`${stmt};`)
  }

  return db
}

export async function execute(sql: string, params?: unknown[]): Promise<void> {
  const conn = await getDb()
  return conn.execute(sql, params)
}

export async function select<T>(sql: string, params?: unknown[]): Promise<T[]> {
  const conn = await getDb()
  return conn.select<T>(sql, params)
}
