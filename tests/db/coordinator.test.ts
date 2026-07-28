import type { DbDriver } from '~/lib/db/coordinator'
import { describe, expect, it, vi } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function driverWithLog(events: string[]): DbDriver {
  return {
    async execute(sql) {
      events.push(`execute:${sql}`)
    },
    async select<T>(sql: string): Promise<T[]> {
      events.push(`select:${sql}`)
      return []
    },
    async close() {
      events.push('close')
    },
  }
}

describe('桌面数据库连接协调器', () => {
  it('并发冷启动只初始化一次，失败后允许下一次重试', async () => {
    const firstAttempt = deferred<DbDriver>()
    const driver = driverWithLog([])
    const load = vi.fn()
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce(driver)
    const coordinator = createDbCoordinator(load)

    const first = coordinator.getDb()
    const second = coordinator.getDb()
    const failure = new Error('migration failed')
    firstAttempt.reject(failure)

    await expect(Promise.all([first, second])).rejects.toBe(failure)
    expect(load).toHaveBeenCalledTimes(1)

    await expect(coordinator.getDb()).resolves.toBeDefined()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('事务持有独占连接直到 COMMIT，普通查询不得插入事务中间', async () => {
    const events: string[] = []
    const driver = driverWithLog(events)
    const entered = deferred()
    const release = deferred()
    const coordinator = createDbCoordinator(async () => driver)

    const transaction = coordinator.withTransaction(async (tx) => {
      await tx.execute('WRITE')
      entered.resolve()
      await release.promise
      return 'done'
    })
    await entered.promise

    const outside = coordinator.select('OUTSIDE')
    await Promise.resolve()
    expect(events).toEqual(['execute:BEGIN', 'execute:WRITE'])

    release.resolve()
    await expect(transaction).resolves.toBe('done')
    await outside
    expect(events).toEqual([
      'execute:BEGIN',
      'execute:WRITE',
      'execute:COMMIT',
      'select:OUTSIDE',
    ])
  })

  it('普通并发查询也保持最多一个底层调用在途', async () => {
    const firstStarted = deferred()
    const releaseFirst = deferred()
    let inFlight = 0
    let maxInFlight = 0
    const driver = driverWithLog([])
    driver.select = async <T>(sql: string): Promise<T[]> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      if (sql === 'FIRST') {
        firstStarted.resolve()
        await releaseFirst.promise
      }
      inFlight -= 1
      return []
    }
    const coordinator = createDbCoordinator(async () => driver)

    const first = coordinator.select('FIRST')
    await firstStarted.promise
    const second = coordinator.select('SECOND')
    await Promise.resolve()
    expect(maxInFlight).toBe(1)

    releaseFirst.resolve()
    await Promise.all([first, second])
    expect(maxInFlight).toBe(1)
  })

  it('事务失败时回滚且不毒化后续连接队列', async () => {
    const events: string[] = []
    const failure = new Error('write failed')
    const coordinator = createDbCoordinator(async () => driverWithLog(events))

    await expect(coordinator.withTransaction(async (tx) => {
      await tx.execute('WRITE')
      throw failure
    })).rejects.toBe(failure)

    await coordinator.select('AFTER_FAILURE')
    expect(events).toEqual([
      'execute:BEGIN',
      'execute:WRITE',
      'execute:ROLLBACK',
      'select:AFTER_FAILURE',
    ])
  })

  it('只在独立写入或事务提交成功后持久化浏览器快照', async () => {
    const events: string[] = []
    const driver = driverWithLog(events)
    driver.persist = async () => {
      events.push('persist')
    }
    const coordinator = createDbCoordinator(async () => driver)

    await coordinator.execute('STANDALONE_WRITE')
    await coordinator.withTransaction(async (tx) => {
      await tx.execute('TRANSACTION_WRITE')
    })

    expect(events).toEqual([
      'execute:STANDALONE_WRITE',
      'persist',
      'execute:BEGIN',
      'execute:TRANSACTION_WRITE',
      'execute:COMMIT',
      'persist',
    ])
  })

  it('事务回滚后不持久化中间快照', async () => {
    const events: string[] = []
    const driver = driverWithLog(events)
    driver.persist = async () => {
      events.push('persist')
    }
    const coordinator = createDbCoordinator(async () => driver)

    await expect(coordinator.withTransaction(async (tx) => {
      await tx.execute('TRANSACTION_WRITE')
      throw new Error('stop')
    })).rejects.toThrow('stop')

    expect(events).toEqual([
      'execute:BEGIN',
      'execute:TRANSACTION_WRITE',
      'execute:ROLLBACK',
    ])
  })
})
