const DATABASE_NAME = 'crm-new-browser'
const DATABASE_VERSION = 2
const SNAPSHOT_STORE = 'database_snapshots'
const BACKUP_STORE = 'database_backups'
const SETTINGS_STORE = 'database_settings'
const LEGACY_PRODUCTION_READ_ONLY_KEY = 'legacy-production-read-only'
const ACTIVE_CORE_MIGRATION_KEY = 'active-core-migration'
const PENDING_CORE_MIGRATION_KEY = 'pending-core-migration'
export type BrowserDatabaseSnapshotKey = 'production' | 'demo'

export interface BrowserCoreMigrationMarker {
  batchId: string
  backupId: string
  sourceHash: string
  confirmedAt: string
  rollbackExpiresAt: string
}

export interface BrowserCoreMigrationPendingMarker {
  batchId: string
  backupId: string
  sourceHash: string
  snapshotSha256: string
  commandId: string
}

export interface BrowserDatabaseBackupMetadata {
  backupId: string
  createdAt: string
  sourceSchemaVersion: number
  sourceVersion: string
  sourceHash: string
  snapshotSha256: string
  immutable: true
  snapshotKey: 'production'
  byteLength: number
}

export interface BrowserDatabaseBackup {
  metadata: BrowserDatabaseBackupMetadata
  snapshot: Uint8Array
}

interface StoredBrowserDatabaseBackup {
  metadata: BrowserDatabaseBackupMetadata
  snapshot: ArrayBuffer
}

export interface CreateBrowserDatabaseBackupInput {
  backupId: string
  createdAt: string
  sourceSchemaVersion: number
  sourceVersion: string
  sourceHash: string
  snapshotSha256: string
  snapshot: Uint8Array
}

export interface BrowserDatabaseBackupProblem extends Error {
  code: 'backup-already-exists' | 'backup-not-found' | 'backup-integrity-failed'
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value.slice().buffer)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('浏览器数据库请求失败')),
      { once: true },
    )
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('浏览器数据库事务已中止')),
      { once: true },
    )
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('浏览器数据库事务失败')),
      { once: true },
    )
  })
}

async function openSnapshotDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.addEventListener('upgradeneeded', () => {
    if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE))
      request.result.createObjectStore(SNAPSHOT_STORE)
    if (!request.result.objectStoreNames.contains(BACKUP_STORE))
      request.result.createObjectStore(BACKUP_STORE)
    if (!request.result.objectStoreNames.contains(SETTINGS_STORE))
      request.result.createObjectStore(SETTINGS_STORE)
  })
  return requestResult(request)
}

function backupProblem(
  code: BrowserDatabaseBackupProblem['code'],
  message: string,
): BrowserDatabaseBackupProblem {
  return Object.assign(new Error(message), { code })
}

export async function loadBrowserDatabase(snapshotKey: BrowserDatabaseSnapshotKey): Promise<Uint8Array | null> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult<ArrayBuffer | Uint8Array | undefined>(
      transaction.objectStore(SNAPSHOT_STORE).get(snapshotKey),
    )
    await done
    if (!value)
      return null
    return value instanceof Uint8Array ? value : new Uint8Array(value)
  }
  finally {
    database.close()
  }
}

export async function saveBrowserDatabase(
  snapshotKey: BrowserDatabaseSnapshotKey,
  snapshot: Uint8Array,
): Promise<void> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite')
    const done = transactionDone(transaction)
    await requestResult(
      transaction.objectStore(SNAPSHOT_STORE).put(snapshot.slice().buffer, snapshotKey),
    )
    await done
  }
  finally {
    database.close()
  }
}

export async function createBrowserDatabaseBackup(
  input: CreateBrowserDatabaseBackupInput,
): Promise<BrowserDatabaseBackupMetadata> {
  if (await sha256Bytes(input.snapshot) !== input.snapshotSha256) {
    throw backupProblem(
      'backup-integrity-failed',
      '本地备份字节摘要与备份证明不一致',
    )
  }
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(BACKUP_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(BACKUP_STORE)
    const existing = await requestResult<StoredBrowserDatabaseBackup | undefined>(
      store.get(input.backupId),
    )
    if (existing) {
      await done
      const storedBytes = new Uint8Array(existing.snapshot)
      const sameSnapshot = storedBytes.byteLength === input.snapshot.byteLength
        && storedBytes.every((byte, index) => byte === input.snapshot[index])
      if (sameSnapshot
        && existing.metadata.sourceHash === input.sourceHash
        && existing.metadata.sourceVersion === input.sourceVersion
        && existing.metadata.snapshotSha256 === input.snapshotSha256) {
        return { ...existing.metadata }
      }
      throw backupProblem('backup-already-exists', '同一迁移批次的本地备份已经存在，不能覆盖')
    }

    const metadata: BrowserDatabaseBackupMetadata = {
      backupId: input.backupId,
      createdAt: input.createdAt,
      sourceSchemaVersion: input.sourceSchemaVersion,
      sourceVersion: input.sourceVersion,
      sourceHash: input.sourceHash,
      snapshotSha256: input.snapshotSha256,
      immutable: true,
      snapshotKey: 'production',
      byteLength: input.snapshot.byteLength,
    }
    await requestResult(store.put({
      metadata,
      snapshot: input.snapshot.slice().buffer,
    } satisfies StoredBrowserDatabaseBackup, input.backupId))
    await done
    return { ...metadata }
  }
  finally {
    database.close()
  }
}

export async function loadBrowserDatabaseBackup(
  backupId: string,
): Promise<BrowserDatabaseBackup | null> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(BACKUP_STORE, 'readonly')
    const done = transactionDone(transaction)
    const stored = await requestResult<StoredBrowserDatabaseBackup | undefined>(
      transaction.objectStore(BACKUP_STORE).get(backupId),
    )
    await done
    if (!stored)
      return null
    const snapshot = new Uint8Array(stored.snapshot.slice(0))
    if (stored.metadata.immutable !== true
      || stored.metadata.snapshotKey !== 'production'
      || stored.metadata.byteLength !== snapshot.byteLength
      || await sha256Bytes(snapshot) !== stored.metadata.snapshotSha256) {
      throw backupProblem(
        'backup-integrity-failed',
        '受保护的本地迁移备份完整性校验失败',
      )
    }
    return {
      metadata: { ...stored.metadata },
      snapshot,
    }
  }
  finally {
    database.close()
  }
}

export async function restoreBrowserDatabaseBackup(backupId: string): Promise<void> {
  const backup = await loadBrowserDatabaseBackup(backupId)
  if (!backup)
    throw backupProblem('backup-not-found', '找不到受保护的本地迁移备份')
  await saveBrowserDatabase('production', backup.snapshot)
}

export async function loadLegacyProductionReadOnly(): Promise<boolean> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult<boolean | undefined>(
      transaction.objectStore(SETTINGS_STORE).get(LEGACY_PRODUCTION_READ_ONLY_KEY),
    )
    await done
    return value === true
  }
  finally {
    database.close()
  }
}

export async function saveLegacyProductionReadOnly(readOnly: boolean): Promise<void> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    await requestResult(
      transaction.objectStore(SETTINGS_STORE).put(
        readOnly,
        LEGACY_PRODUCTION_READ_ONLY_KEY,
      ),
    )
    await done
  }
  finally {
    database.close()
  }
}

export async function loadBrowserCoreMigrationMarker(): Promise<BrowserCoreMigrationMarker | null> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult<BrowserCoreMigrationMarker | undefined>(
      transaction.objectStore(SETTINGS_STORE).get(ACTIVE_CORE_MIGRATION_KEY),
    )
    await done
    return value ? { ...value } : null
  }
  finally {
    database.close()
  }
}

export async function loadBrowserCoreMigrationPendingMarker(): Promise<BrowserCoreMigrationPendingMarker | null> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult<BrowserCoreMigrationPendingMarker | undefined>(
      transaction.objectStore(SETTINGS_STORE).get(PENDING_CORE_MIGRATION_KEY),
    )
    await done
    return value ? { ...value } : null
  }
  finally {
    database.close()
  }
}

export async function prepareBrowserCoreMigration(marker: BrowserCoreMigrationPendingMarker): Promise<void> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(SETTINGS_STORE)
    await Promise.all([
      requestResult(store.put({ ...marker }, PENDING_CORE_MIGRATION_KEY)),
      requestResult(store.put(true, LEGACY_PRODUCTION_READ_ONLY_KEY)),
    ])
    await done
  }
  finally {
    database.close()
  }
}

export async function activateBrowserCoreMigration(
  marker: BrowserCoreMigrationMarker,
): Promise<void> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(SETTINGS_STORE)
    await Promise.all([
      requestResult(store.put({ ...marker }, ACTIVE_CORE_MIGRATION_KEY)),
      requestResult(store.delete(PENDING_CORE_MIGRATION_KEY)),
      requestResult(store.put(true, LEGACY_PRODUCTION_READ_ONLY_KEY)),
    ])
    await done
  }
  finally {
    database.close()
  }
}

export async function clearBrowserCoreMigration(): Promise<void> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SETTINGS_STORE, 'readwrite')
    const done = transactionDone(transaction)
    const store = transaction.objectStore(SETTINGS_STORE)
    await Promise.all([
      requestResult(store.delete(ACTIVE_CORE_MIGRATION_KEY)),
      requestResult(store.delete(PENDING_CORE_MIGRATION_KEY)),
      requestResult(store.put(false, LEGACY_PRODUCTION_READ_ONLY_KEY)),
    ])
    await done
  }
  finally {
    database.close()
  }
}
