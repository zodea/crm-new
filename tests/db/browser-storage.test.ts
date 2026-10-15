import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activateBrowserCoreMigration,
  clearBrowserCoreMigration,
  createBrowserDatabaseBackup,
  loadBrowserCoreMigrationMarker,
  loadBrowserDatabase,
  loadBrowserDatabaseBackup,
  loadLegacyProductionReadOnly,
  restoreBrowserDatabaseBackup,
  saveBrowserDatabase,
} from '~/lib/db/browser-storage'

type Listener = (event: Event) => void

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

class FakeEventTarget {
  private readonly listeners = new Map<string, Listener[]>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener)
      return
    const callback: Listener = typeof listener === 'function'
      ? listener as Listener
      : event => listener.handleEvent(event)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new Event(type))
  }
}

class FakeRequest<T> extends FakeEventTarget {
  result!: T
  error: DOMException | null = null
}

class FakeTransaction extends FakeEventTarget {
  error: DOMException | null = null
  private pending = 0

  constructor(private readonly stores: Map<string, Map<IDBValidKey, unknown>>) {
    super()
  }

  objectStore(name: string): IDBObjectStore {
    const values = this.stores.get(name)
    if (!values)
      throw new Error(`missing fake store: ${name}`)
    const schedule = <T>(work: () => T) => {
      const request = new FakeRequest<T>()
      this.pending += 1
      setTimeout(() => {
        request.result = work()
        request.dispatch('success')
        this.pending -= 1
        setTimeout(() => {
          if (this.pending === 0)
            this.dispatch('complete')
        }, 0)
      }, 0)
      return request as unknown as IDBRequest<T>
    }
    return {
      delete: key => schedule(() => values.delete(key)),
      get: key => schedule(() => values.get(key)),
      put: (value, key) => schedule(() => {
        values.set(key, value)
        return key
      }),
    } as unknown as IDBObjectStore
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<IDBValidKey, unknown>>()
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  } as DOMStringList

  createObjectStore(name: string): IDBObjectStore {
    this.stores.set(name, new Map())
    return {} as IDBObjectStore
  }

  transaction(_storeName: string): IDBTransaction {
    return new FakeTransaction(this.stores) as unknown as IDBTransaction
  }

  close(): void {}
}

function createFakeIndexedDb(): IDBFactory {
  const database = new FakeDatabase()
  let version = 0
  return {
    open: (_name: string, nextVersion?: number) => {
      const request = new FakeRequest<IDBDatabase>()
      setTimeout(() => {
        request.result = database as unknown as IDBDatabase
        if ((nextVersion ?? 1) > version) {
          version = nextVersion ?? 1
          request.dispatch('upgradeneeded')
        }
        request.dispatch('success')
      }, 0)
      return request as unknown as IDBOpenDBRequest
    },
  } as IDBFactory
}

describe('browser database migration backup', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', createFakeIndexedDb())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps an immutable production backup separate from the live and demo snapshots', async () => {
    await saveBrowserDatabase('production', new Uint8Array([1, 2, 3]))
    await saveBrowserDatabase('demo', new Uint8Array([7, 8]))
    const metadata = await createBrowserDatabaseBackup({
      backupId: 'core-migration-batch-1',
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: 40,
      sourceVersion: 'sqlite-v40',
      sourceHash: 'a'.repeat(64),
      snapshotSha256: sha256Bytes(new Uint8Array([1, 2, 3])),
      snapshot: new Uint8Array([1, 2, 3]),
    })
    await expect(createBrowserDatabaseBackup({
      backupId: 'core-migration-batch-1',
      createdAt: '2026-08-15T02:00:00.000Z',
      sourceSchemaVersion: 40,
      sourceVersion: 'sqlite-v40',
      sourceHash: 'a'.repeat(64),
      snapshotSha256: sha256Bytes(new Uint8Array([1, 2, 3])),
      snapshot: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual(metadata)

    await saveBrowserDatabase('production', new Uint8Array([9]))
    await expect(createBrowserDatabaseBackup({
      backupId: 'core-migration-batch-1',
      createdAt: '2026-08-15T02:00:00.000Z',
      sourceSchemaVersion: 40,
      sourceVersion: 'sqlite-v40',
      sourceHash: 'a'.repeat(64),
      snapshotSha256: sha256Bytes(new Uint8Array([9])),
      snapshot: new Uint8Array([9]),
    })).rejects.toMatchObject({ code: 'backup-already-exists' })

    await restoreBrowserDatabaseBackup('core-migration-batch-1')

    expect(metadata).toEqual({
      backupId: 'core-migration-batch-1',
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: 40,
      sourceVersion: 'sqlite-v40',
      sourceHash: 'a'.repeat(64),
      snapshotSha256: sha256Bytes(new Uint8Array([1, 2, 3])),
      immutable: true,
      snapshotKey: 'production',
      byteLength: 3,
    })
    expect([...await loadBrowserDatabase('production') ?? []]).toEqual([1, 2, 3])
    expect([...await loadBrowserDatabase('demo') ?? []]).toEqual([7, 8])
    expect([...(await loadBrowserDatabaseBackup('core-migration-batch-1'))!.snapshot]).toEqual([1, 2, 3])
  })

  it('rejects a backup attestation whose digest does not match the protected bytes', async () => {
    await expect(createBrowserDatabaseBackup({
      backupId: 'forged-backup',
      createdAt: '2026-08-15T01:00:00.000Z',
      sourceSchemaVersion: 40,
      sourceVersion: 'sqlite-v40',
      sourceHash: 'a'.repeat(64),
      snapshotSha256: 'b'.repeat(64),
      snapshot: new Uint8Array([1, 2, 3]),
    })).rejects.toMatchObject({ code: 'backup-integrity-failed' })
  })

  it('persists and clears the active migration marker atomically with the legacy lock', async () => {
    const marker = {
      batchId: 'batch-1',
      backupId: 'core-migration-source-hash',
      sourceHash: 'a'.repeat(64),
      confirmedAt: '2026-08-15T01:00:00.000Z',
      rollbackExpiresAt: '2026-08-22T01:00:00.000Z',
    }

    await activateBrowserCoreMigration(marker)

    await expect(loadLegacyProductionReadOnly()).resolves.toBe(true)
    await expect(loadBrowserCoreMigrationMarker()).resolves.toEqual(marker)

    await clearBrowserCoreMigration()

    await expect(loadLegacyProductionReadOnly()).resolves.toBe(false)
    await expect(loadBrowserCoreMigrationMarker()).resolves.toBeNull()
  })
})
