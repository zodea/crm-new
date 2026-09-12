import type { Database } from 'sql.js'
import type { DbDriver, TransactionDb } from '../../app/lib/db/coordinator'
import type { PreparedCoreMigration } from './core-migration-preparation'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runMigrations } from '../../app/lib/db/migrations'

let runtime: ReturnType<typeof initSqlJs> | null = null

function driverFor(database: () => Database): DbDriver {
  return {
    async execute(sql, params = []) { database().run(sql, params as never[]) },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = database().prepare(sql)
      try {
        statement.bind(params as never[])
        const rows: T[] = []
        while (statement.step())
          rows.push(statement.getAsObject() as T)
        return rows
      }
      finally { statement.free() }
    },
    async close() { database().close() },
  }
}

async function initializeExternalBoqReferences(driver: TransactionDb) {
  const [table] = await driver.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=\'house_type_template_items\'')
  const indexes = await driver.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'index\' AND tbl_name=\'house_type_template_items\' AND sql IS NOT NULL')
  const columns = await driver.select<{ name: string }>('PRAGMA table_info(house_type_template_items)')
  const reference = /REFERENCES\s+boq_lines\s*\(\s*id\s*\)/i
  if (!table?.sql || !reference.test(table.sql) || columns.some(column => !/^[a-z_]+$/.test(column.name)))
    throw new Error('工程量中央BOQ外键结构与已知本地表不一致')
  await driver.execute('PRAGMA foreign_keys = OFF')
  try {
    await driver.execute('BEGIN')
    await driver.execute('CREATE TABLE quantity_boq_references (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), contract_id TEXT NOT NULL)')
    await driver.execute(table.sql.replace(/\bhouse_type_template_items\b/, 'quantity_template_items_next').replace(reference, 'REFERENCES quantity_boq_references(id)'))
    const names = columns.map(column => column.name).join(', ')
    await driver.execute(`INSERT INTO quantity_template_items_next (${names}) SELECT ${names} FROM house_type_template_items`)
    await driver.execute('DROP TABLE house_type_template_items')
    await driver.execute('ALTER TABLE quantity_template_items_next RENAME TO house_type_template_items')
    for (const index of indexes)
      await driver.execute(index.sql)
    if ((await driver.select('PRAGMA foreign_key_check')).length)
      throw new Error('工程量中央BOQ外键初始化未通过核对')
    await driver.execute('COMMIT')
  }
  catch (cause) {
    await driver.execute('ROLLBACK')
    throw cause
  }
  finally { await driver.execute('PRAGMA foreign_keys = ON') }
}

/** 可重置中央内存数据库。候选副本不公开，提交仅交换连接，不重建领域 service。 */
export async function createQuantityDatabase() {
  if (!runtime) {
    const wasmPath = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm')
    runtime = initSqlJs({ locateFile: () => wasmPath })
    void runtime.catch(() => {
      runtime = null
    })
  }
  const SQL = await runtime
  let connection = new SQL.Database()
  const driver = driverFor(() => connection)
  try {
    await runMigrations(driver)
    await initializeExternalBoqReferences(driver)
  }
  catch (cause) {
    await driver.close()
    throw cause
  }
  return {
    ...driver,
    async prepare(work: (candidate: TransactionDb) => Promise<void>): Promise<PreparedCoreMigration> {
      const bytes = connection.export()
      // sql.js export 会重开原连接；重新恢复该连接的运行期外键约束。
      connection.run('PRAGMA foreign_keys = ON')
      const candidate = new SQL.Database(bytes)
      const candidateDriver = driverFor(() => candidate)
      let finished = false
      try {
        await candidateDriver.execute('PRAGMA foreign_keys = ON')
        await candidateDriver.execute('BEGIN')
        await candidateDriver.execute('PRAGMA defer_foreign_keys = ON')
        await work(candidateDriver)
        await candidateDriver.execute('COMMIT')
      }
      catch (cause) {
        await candidateDriver.close()
        throw cause
      }
      return {
        commit() {
          if (finished)
            return
          finished = true
          const previous = connection
          connection = candidate
          previous.close()
        },
        async abort() {
          if (finished)
            return
          finished = true
          await candidateDriver.close()
        },
      }
    },
  }
}
