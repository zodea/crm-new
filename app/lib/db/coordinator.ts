export interface DbDriver {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
  /**
   * Flushes a driver-managed snapshot after a successful logical write.
   * Native SQLite persists by itself; the browser sql.js driver implements this hook.
   */
  persist?: () => Promise<void>
  /** Optional consistent disk snapshot; never exposes the native connection to callers. */
  backupTo?: (destination: string) => Promise<void>
  close: () => Promise<void>
}

export type TransactionDb = Pick<DbDriver, 'execute' | 'select'>

/**
 * 把惰性数据库驱动收口成单初始化、单连接队列。
 *
 * 分开发出的 BEGIN / SQL / COMMIT 不会天然互斥。这里保证从冷启动起最多只有一个底层
 * 调用在途，事务回调再独占整个队列，因而同一组语句不会被其他调用方穿插。
 */
export function createDbCoordinator(load: () => Promise<DbDriver>) {
  let driver: DbDriver | null = null
  let initializing: Promise<DbDriver> | null = null
  let queue: Promise<void> = Promise.resolve()

  function rawDriver(): Promise<DbDriver> {
    if (driver)
      return Promise.resolve(driver)
    if (!initializing) {
      const attempt = Promise.resolve().then(load)
      const pending = attempt.then((loaded) => {
        driver = loaded
        return loaded
      })
      initializing = pending
      void pending.catch(() => {
        if (initializing === pending)
          initializing = null
      })
    }
    return initializing
  }

  function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  async function execute(sql: string, params?: unknown[]): Promise<void> {
    return runExclusive(async () => {
      const raw = await rawDriver()
      await raw.execute(sql, params)
      await raw.persist?.()
    })
  }

  async function select<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return runExclusive(async () => {
      const raw = await rawDriver()
      return raw.select<T>(sql, params)
    })
  }

  async function close(): Promise<void> {
    return runExclusive(async () => {
      const raw = await rawDriver()
      await raw.persist?.()
      await raw.close()
      driver = null
      initializing = null
    })
  }

  async function backupTo(destination: string): Promise<void> {
    return runExclusive(async () => {
      const raw = await rawDriver()
      if (!raw.backupTo)
        throw new Error('当前数据库驱动不支持一致磁盘备份。')
      await raw.backupTo(destination)
    })
  }

  const facade: DbDriver = { execute, select, close }

  async function getDb(): Promise<DbDriver> {
    await rawDriver()
    return facade
  }

  async function withTransaction<T>(work: (tx: TransactionDb) => Promise<T>): Promise<T> {
    return runExclusive(async () => {
      const raw = await rawDriver()
      const tx: TransactionDb = {
        execute: (sql, params) => raw.execute(sql, params),
        select: <TResult>(sql: string, params?: unknown[]) => raw.select<TResult>(sql, params),
      }

      await raw.execute('BEGIN')
      try {
        const result = await work(tx)
        await raw.execute('COMMIT')
        await raw.persist?.()
        return result
      }
      catch (error) {
        try {
          await raw.execute('ROLLBACK')
        }
        catch {
          // 保留触发回滚的原始异常，避免清理失败覆盖真正根因。
        }
        throw error
      }
    })
  }

  return { getDb, execute, select, close, withTransaction, backupTo }
}
