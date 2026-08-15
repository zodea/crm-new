import type {
  BrowserCoreMigrationMarker,
  BrowserCoreMigrationPendingMarker,
  BrowserDatabaseBackupMetadata,
} from '../db/browser-storage'
import type {
  CoreMigrationEntityType,
  CoreMigrationSourceDTO,
  CoreMigrationSourceEntitiesDTO,
  CoreMigrationSourceEntityDTO,
  CoreMigrationTotalExpectationDTO,
} from './core-contract'
import { isTauri } from '@tauri-apps/api/core'
import {
  activateBrowserCoreMigration,
  clearBrowserCoreMigration,
  createBrowserDatabaseBackup,
  loadBrowserCoreMigrationMarker,
  loadBrowserCoreMigrationPendingMarker,
  loadBrowserDatabase,
  loadBrowserDatabaseBackup,
  prepareBrowserCoreMigration,
  restoreBrowserDatabaseBackup,
} from '../db/browser-storage'
import { closeDb, getDb } from '../db/connection'
import { getCurrentVersion } from '../db/migrations'
import { openBrowserSqlite } from '../db/sqljs'
import {
  compareCanonicalText,
  CORE_MIGRATION_CONTRACT_VERSION,
  CORE_MIGRATION_SOURCE_MODE,
  CORE_MIGRATION_TOPOLOGY,
  coreMigrationCentsToMoney,
  coreMigrationMoneyToCents,
  coreMigrationSourceHashInput,
  isCoreMigrationMoney,
} from './core-contract'

export interface CoreMigrationLocalSourceDependencies {
  isNative: () => boolean
  isDemoActive: () => boolean
  currentSchemaVersion: () => Promise<number>
  select: <T extends Record<string, unknown>>(sql: string) => Promise<T[]>
  closeDatabase: () => Promise<void>
  loadProductionSnapshot: () => Promise<Uint8Array | null>
  readSnapshotSource: (snapshot: Uint8Array) => Promise<CoreMigrationSourceDTO>
  createBackup: typeof createBrowserDatabaseBackup
  loadBackup: typeof loadBrowserDatabaseBackup
  restoreBackup: typeof restoreBrowserDatabaseBackup
  activateMigration: typeof activateBrowserCoreMigration
  clearMigration: typeof clearBrowserCoreMigration
  prepareMigration: typeof prepareBrowserCoreMigration
  loadMigrationMarker: typeof loadBrowserCoreMigrationMarker
  loadPendingMigrationMarker: typeof loadBrowserCoreMigrationPendingMarker
  now: () => string
}

export interface CoreMigrationLocalSourceProblem extends Error {
  code:
    | 'browser-only'
    | 'demo-source-not-allowed'
    | 'production-snapshot-missing'
    | 'source-changed-after-preflight'
    | 'backup-integrity-failed'
    | 'unidentifiable-source-row'
}

const ENTITY_SQL: Record<CoreMigrationEntityType, string> = {
  customers: `
    SELECT id, name, deleted_at
    FROM customers
    ORDER BY id
  `,
  suppliers: `
    SELECT id, name, deleted_at
    FROM suppliers
    ORDER BY id
  `,
  crews: `
    SELECT id, name, deleted_at
    FROM crews
    ORDER BY id
  `,
  projects: `
    SELECT
      id, name, customer_id, secondary_customer_id,
      area, contract_amount, deleted_at
    FROM projects
    ORDER BY id
  `,
  workers: `
    SELECT id, name, crew_id, current_project_id, deleted_at
    FROM workers
    ORDER BY id
  `,
  project_suppliers: `
    SELECT id, project_id, supplier_id, deleted_at
    FROM project_suppliers
    ORDER BY id
  `,
}

function problem(
  code: CoreMigrationLocalSourceProblem['code'],
  message: string,
): CoreMigrationLocalSourceProblem {
  return Object.assign(new Error(message), { code })
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function nullableText(value: unknown): string | null {
  return text(value) || null
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableMoney(value: unknown): string | null {
  const parsed = nullableNumber(value)
  if (parsed === null)
    return null
  const money = (Math.round((parsed + Number.EPSILON) * 100) / 100).toFixed(2)
  if (!isCoreMigrationMoney(money))
    throw problem('unidentifiable-source-row', '本地金额超出可精确迁移范围')
  return money
}

function baseEntity(row: Record<string, unknown>): CoreMigrationSourceEntityDTO {
  return {
    legacyId: text(row.id),
    name: text(row.name),
    deletedAt: nullableText(row.deleted_at),
  }
}

function sourceEntity(
  entityType: CoreMigrationEntityType,
  row: Record<string, unknown>,
): CoreMigrationSourceEntityDTO {
  const entity = baseEntity(row)
  if (entityType === 'projects') {
    return {
      ...entity,
      references: {
        customerId: nullableText(row.customer_id),
        secondaryCustomerId: nullableText(row.secondary_customer_id),
      },
      quantity: nullableNumber(row.area),
      amount: nullableMoney(row.contract_amount),
    }
  }
  if (entityType === 'workers') {
    return {
      ...entity,
      references: {
        crewId: nullableText(row.crew_id),
        projectId: nullableText(row.current_project_id),
      },
    }
  }
  if (entityType === 'project_suppliers') {
    const projectId = nullableText(row.project_id)
    const supplierId = nullableText(row.supplier_id)
    return {
      ...entity,
      name: `${projectId ?? '未关联项目'} × ${supplierId ?? '未关联分供方'}`,
      references: { projectId, supplierId },
    }
  }
  return entity
}

function countExpectations(
  entities: CoreMigrationSourceEntitiesDTO,
): Partial<Record<CoreMigrationEntityType, number>> {
  return Object.fromEntries(
    CORE_MIGRATION_TOPOLOGY.map(entityType => [entityType, entities[entityType].length]),
  )
}

function totalExpectations(
  entities: CoreMigrationSourceEntitiesDTO,
): CoreMigrationTotalExpectationDTO[] {
  const totals: CoreMigrationTotalExpectationDTO[] = []
  for (const entityType of CORE_MIGRATION_TOPOLOGY) {
    const quantities = entities[entityType]
      .map(entity => entity.quantity)
      .filter((value): value is number => value != null)
    if (quantities.length) {
      totals.push({
        entityType,
        metric: 'quantity',
        expected: quantities.reduce((sum, value) => sum + value, 0),
      })
    }
    const amounts = entities[entityType]
      .map(entity => entity.amount)
      .filter((value): value is string => value != null)
    if (amounts.length) {
      const total = amounts.reduce(
        (sum, value) => sum + coreMigrationMoneyToCents(value),
        BigInt(0),
      )
      totals.push({
        entityType,
        metric: 'amount',
        expected: coreMigrationCentsToMoney(total),
      })
    }
  }
  return totals
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    value.slice().buffer,
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

type SourceSelect = <T extends Record<string, unknown>>(sql: string) => Promise<T[]>

async function buildSource(
  schemaVersion: number,
  selectSource: SourceSelect,
): Promise<CoreMigrationSourceDTO> {
  const entries = await Promise.all(CORE_MIGRATION_TOPOLOGY.map(async (entityType) => {
    const rows = await selectSource<Record<string, unknown>>(ENTITY_SQL[entityType])
    const entities = rows
      .map(row => sourceEntity(entityType, row))
      .sort((left, right) => compareCanonicalText(left.legacyId, right.legacyId))
    const invalid = entities.find(entity => !entity.legacyId || !entity.name)
    if (invalid) {
      throw problem(
        'unidentifiable-source-row',
        `${entityType} 存在缺少旧 ID 或名称的记录，不能静默丢弃`,
      )
    }
    return [entityType, entities] as const
  }))
  const entities = Object.fromEntries(entries) as CoreMigrationSourceEntitiesDTO
  const withoutHash = {
    contractVersion: CORE_MIGRATION_CONTRACT_VERSION,
    mode: CORE_MIGRATION_SOURCE_MODE,
    sourceVersion: `sqlite-v${schemaVersion}`,
    entities,
    expectations: {
      counts: countExpectations(entities),
      totals: totalExpectations(entities),
    },
  }
  return {
    ...withoutHash,
    sourceHash: await sha256(coreMigrationSourceHashInput(withoutHash)),
  }
}

async function readSqliteSnapshotSource(snapshot: Uint8Array): Promise<CoreMigrationSourceDTO> {
  const database = await openBrowserSqlite(snapshot)
  const selectSnapshot: SourceSelect = async <T extends Record<string, unknown>>(sql: string) => {
    const statement = database.prepare(sql)
    const rows: T[] = []
    try {
      while (statement.step())
        rows.push(statement.getAsObject() as T)
      return rows
    }
    finally {
      statement.free()
    }
  }
  try {
    const versions = await selectSnapshot<{ version: number }>(
      'SELECT MAX(version) AS version FROM schema_migrations',
    )
    const schemaVersion = Number(versions[0]?.version ?? 0)
    return await buildSource(schemaVersion, selectSnapshot)
  }
  finally {
    database.close()
  }
}

function defaultDependencies(): CoreMigrationLocalSourceDependencies {
  return {
    isNative: isTauri,
    isDemoActive: () => useDataVisibilityStore().includeDemo,
    currentSchemaVersion: async () => getCurrentVersion(await getDb()),
    select: async <T extends Record<string, unknown>>(sql: string) => {
      const database = await getDb()
      return database.select<T>(sql)
    },
    closeDatabase: closeDb,
    loadProductionSnapshot: () => loadBrowserDatabase('production'),
    readSnapshotSource: readSqliteSnapshotSource,
    createBackup: createBrowserDatabaseBackup,
    loadBackup: loadBrowserDatabaseBackup,
    restoreBackup: restoreBrowserDatabaseBackup,
    activateMigration: activateBrowserCoreMigration,
    clearMigration: clearBrowserCoreMigration,
    prepareMigration: prepareBrowserCoreMigration,
    loadMigrationMarker: loadBrowserCoreMigrationMarker,
    loadPendingMigrationMarker: loadBrowserCoreMigrationPendingMarker,
    now: () => new Date().toISOString(),
  }
}

export function createCoreMigrationLocalSource(
  dependencies: CoreMigrationLocalSourceDependencies = defaultDependencies(),
) {
  async function readSource(): Promise<CoreMigrationSourceDTO> {
    if (dependencies.isNative())
      throw problem('browser-only', '本地快照迁移首版仅支持浏览器工作区')
    if (dependencies.isDemoActive())
      throw problem('demo-source-not-allowed', '请先关闭“包含测试数据”，再迁移正式本地数据')
    return buildSource(await dependencies.currentSchemaVersion(), dependencies.select)
  }

  async function createBackup(expectedSourceHash: string): Promise<BrowserDatabaseBackupMetadata> {
    if (dependencies.isNative())
      throw problem('browser-only', '本地快照迁移首版仅支持浏览器工作区')
    await dependencies.closeDatabase()
    const snapshot = await dependencies.loadProductionSnapshot()
    if (!snapshot)
      throw problem('production-snapshot-missing', '找不到可备份的本地 production 数据快照')
    const protectedSource = await dependencies.readSnapshotSource(snapshot)
    if (protectedSource.sourceHash !== expectedSourceHash) {
      throw problem(
        'source-changed-after-preflight',
        '预检后本地数据已变化，未创建备份；请重新运行预检',
      )
    }
    const sourceSchemaVersion = Number.parseInt(
      protectedSource.sourceVersion.replace(/^sqlite-v/, ''),
      10,
    )
    const snapshotSha256 = await sha256Bytes(snapshot)
    return dependencies.createBackup({
      backupId: `core-migration-${protectedSource.sourceHash}-${snapshotSha256}`,
      createdAt: dependencies.now(),
      sourceSchemaVersion,
      sourceVersion: protectedSource.sourceVersion,
      sourceHash: protectedSource.sourceHash,
      snapshotSha256,
      snapshot,
    })
  }

  async function assertCurrentSource(
    expectedSourceHash: string,
    expectedSnapshotSha256: string,
  ): Promise<void> {
    if (dependencies.isNative())
      throw problem('browser-only', '本地快照迁移首版仅支持浏览器工作区')
    await dependencies.closeDatabase()
    const snapshot = await dependencies.loadProductionSnapshot()
    if (!snapshot)
      throw problem('production-snapshot-missing', '找不到本地 production 数据快照')
    const [currentSource, currentSnapshotSha256] = await Promise.all([
      dependencies.readSnapshotSource(snapshot),
      sha256Bytes(snapshot),
    ])
    if (currentSource.sourceHash !== expectedSourceHash
      || currentSnapshotSha256 !== expectedSnapshotSha256) {
      throw problem(
        'source-changed-after-preflight',
        '备份后本地正式数据已变化，请重新预检并创建新备份',
      )
    }
  }

  async function prepareSwitch(marker: BrowserCoreMigrationPendingMarker): Promise<void> {
    await dependencies.closeDatabase()
    await dependencies.prepareMigration(marker)
  }

  async function abortSwitch(): Promise<void> {
    await dependencies.clearMigration()
  }

  async function confirmSwitch(marker: BrowserCoreMigrationMarker): Promise<void> {
    await dependencies.closeDatabase()
    await dependencies.activateMigration(marker)
  }

  async function rollback(backupId: string, expectedSourceHash: string): Promise<void> {
    await dependencies.closeDatabase()
    const backup = await dependencies.loadBackup(backupId)
    if (!backup)
      throw problem('backup-integrity-failed', '找不到受保护的本地迁移备份')
    const protectedSource = await dependencies.readSnapshotSource(backup.snapshot)
    if (backup.metadata.sourceHash !== expectedSourceHash
      || protectedSource.sourceHash !== expectedSourceHash
      || protectedSource.sourceVersion !== backup.metadata.sourceVersion) {
      throw problem(
        'backup-integrity-failed',
        '受保护备份的来源哈希或版本与迁移批次不一致',
      )
    }
    await dependencies.restoreBackup(backupId)
    await dependencies.clearMigration()
  }

  return {
    readSource,
    createBackup,
    assertCurrentSource,
    prepareSwitch,
    abortSwitch,
    confirmSwitch,
    rollback,
    loadActiveMigration: dependencies.loadMigrationMarker,
    loadPendingMigration: dependencies.loadPendingMigrationMarker,
  }
}

export type CoreMigrationLocalSource = ReturnType<typeof createCoreMigrationLocalSource>
