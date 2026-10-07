import type { Database } from 'sql.js'
import type { DbDriver, TransactionDb } from '../../app/lib/db/coordinator'
import type { PreparedCoreMigration } from './core-migration-preparation'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { runMigrations } from '../../app/lib/db/migrations'
import { initializeScheduleSchema } from '../../app/lib/schedule/central-schema'
import { initializeQuantityHollowMigrationEvidence } from './quantity-hollow-migration'

let runtime: ReturnType<typeof initSqlJs> | null = null
// 初始化结果只取决于迁移与结构初始化代码；同进程复用其字节，避免每次重置重放全部 ALTER。
let initialized: Promise<Uint8Array> | null = null

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

async function initializeScheduleReferences(driver: TransactionDb) {
  await driver.execute('PRAGMA foreign_keys = OFF')
  try {
    await driver.execute('BEGIN')
    await driver.execute('CREATE TABLE quantity_contract_references (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id))')
    for (const name of ['schedule_groups', 'schedule_tasks', 'task_item_map', 'schedule_task_floor_plans']) {
      const [table] = await driver.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?', [name])
      const indexes = await driver.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'index\' AND tbl_name=? AND sql IS NOT NULL', [name])
      const triggers = await driver.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'trigger\' AND tbl_name=? AND sql IS NOT NULL', [name])
      const columns = await driver.select<{ name: string }>(`PRAGMA table_info(${name})`)
      if (!table?.sql || columns.some(column => !/^[a-z_]+$/.test(column.name)))
        throw new Error('WBS 中央外键结构与已知本地表不一致')
      const sql = table.sql.replace(new RegExp(`\\b${name}\\b`), `${name}_central_next`)
        .replace(/REFERENCES\s+contracts\s*\(\s*id\s*\)/gi, 'REFERENCES quantity_contract_references(id)')
        .replace(/REFERENCES\s+boq_lines\s*\(\s*id\s*\)/gi, 'REFERENCES quantity_boq_references(id)')
        .replace(/AND\s+provisional_qty\s+IS\s+NOT\s+NULL/gi, '')
        .replace(/(template_snapshot_json"?\s+TEXT)\s+NOT\s+NULL/gi, '$1')
      await driver.execute(sql)
      const fields = columns.map(column => column.name).join(', ')
      await driver.execute(`INSERT INTO ${name}_central_next (${fields}) SELECT ${fields} FROM ${name}`)
      await driver.execute(`DROP TABLE ${name}`)
      await driver.execute(`ALTER TABLE ${name}_central_next RENAME TO ${name}`)
      for (const entry of [...indexes, ...triggers])
        await driver.execute(entry.sql)
    }
    // 本地升级种的默认库不是中央正式事实；中央随后只投影授权版本。
    await driver.execute('DELETE FROM schedule_process_library_tasks')
    await driver.execute('DELETE FROM schedule_process_libraries')
    await driver.execute('CREATE TABLE schedule_migration_evidence (entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL, source_graph_json TEXT NOT NULL, provisional_detail_status TEXT NOT NULL)')
    await initializeScheduleSchema(driver)
    if ((await driver.select('PRAGMA foreign_key_check')).length)
      throw new Error('WBS 中央外键初始化未通过核对')
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
  if (!initialized) {
    initialized = (async () => {
      const template = new SQL.Database()
      const driver = driverFor(() => template)
      try {
        await runMigrations(driver)
        await initializeExternalBoqReferences(driver)
        await initializeScheduleReferences(driver)
        await initializeQuantityHollowMigrationEvidence(driver)
        return template.export()
      }
      finally { template.close() }
    })()
    void initialized.catch(() => {
      initialized = null
    })
  }
  let connection = new SQL.Database(await initialized)
  const driver = driverFor(() => connection)
  // 外键开关属于连接状态，不随字节保存；与初始化结束时的连接保持一致。
  connection.run('PRAGMA foreign_keys = ON')
  return {
    ...driver,
    exportSnapshotBytes(): Uint8Array {
      try {
        return connection.export()
      }
      finally {
        // sql.js 导出会重开连接；快照读取不能改变后续事务的外键约束。
        connection.run('PRAGMA foreign_keys = ON')
      }
    },
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
