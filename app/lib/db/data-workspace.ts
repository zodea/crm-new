import type { DbDriver } from './coordinator'

export interface LocalDataWorkspace {
  snapshotKey: 'production' | 'demo'
  seedDemo: boolean
  readOnly: boolean
}

export interface DemoWorkspaceWriteProblem extends Error {
  code: 'demo-workspace-read-only'
}

export interface LegacyProductionWriteProblem extends Error {
  code: 'legacy-production-read-only'
}

const TRANSACTION_CONTROLS = new Set([
  'BEGIN',
  'BEGIN TRANSACTION',
  'BEGIN DEFERRED',
  'BEGIN DEFERRED TRANSACTION',
  'BEGIN IMMEDIATE',
  'BEGIN IMMEDIATE TRANSACTION',
  'BEGIN EXCLUSIVE',
  'BEGIN EXCLUSIVE TRANSACTION',
  'COMMIT',
  'COMMIT TRANSACTION',
  'ROLLBACK',
  'ROLLBACK TRANSACTION',
])

export function localDataWorkspace(
  includeDemo: boolean,
  legacyProductionReadOnly = false,
): LocalDataWorkspace {
  return includeDemo
    ? { snapshotKey: 'demo', seedDemo: true, readOnly: true }
    : { snapshotKey: 'production', seedDemo: false, readOnly: legacyProductionReadOnly }
}

function demoWorkspaceWriteProblem(): DemoWorkspaceWriteProblem {
  return Object.assign(new Error('测试数据只能查看，不能从正式入口修改'), {
    code: 'demo-workspace-read-only' as const,
  })
}

function isReadOnlyQuery(sql: string): boolean {
  const statement = sql.trim().replace(/;\s*$/, '')
  if (statement.includes(';'))
    return false
  if (/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|PRAGMA)\b/i.test(statement))
    return false
  return /^(?:SELECT|WITH)\b/i.test(statement)
}

function isTransactionControl(sql: string): boolean {
  const statement = sql.trim().replace(/;$/, '').trim().replace(/\s+/g, ' ').toUpperCase()
  return TRANSACTION_CONTROLS.has(statement)
}

export function demoReadOnlyDriver(driver: DbDriver): DbDriver {
  return {
    execute: (sql, params) => {
      if (isTransactionControl(sql))
        return driver.execute(sql, params)
      return Promise.reject(demoWorkspaceWriteProblem())
    },
    select: (sql, params) => {
      if (!isReadOnlyQuery(sql))
        return Promise.reject(demoWorkspaceWriteProblem())
      return driver.select(sql, params)
    },
    close: () => driver.close(),
  }
}

function legacyProductionWriteProblem(): LegacyProductionWriteProblem {
  return Object.assign(new Error('中央切换后旧 production 数据只作为迁移来源，不能继续写入'), {
    code: 'legacy-production-read-only' as const,
  })
}

export function legacyProductionReadOnlyDriver(driver: DbDriver): DbDriver {
  return {
    execute: () => Promise.reject(legacyProductionWriteProblem()),
    select: () => Promise.reject(legacyProductionWriteProblem()),
    close: () => driver.close(),
  }
}
