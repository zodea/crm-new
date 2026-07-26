const DATABASE_NAME = 'crm-new-browser'
const DATABASE_VERSION = 1
const SNAPSHOT_STORE = 'database_snapshots'
const PRIMARY_SNAPSHOT_KEY = 'main'

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
  })
  return requestResult(request)
}

export async function loadBrowserDatabase(): Promise<Uint8Array | null> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readonly')
    const done = transactionDone(transaction)
    const value = await requestResult<ArrayBuffer | Uint8Array | undefined>(
      transaction.objectStore(SNAPSHOT_STORE).get(PRIMARY_SNAPSHOT_KEY),
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

export async function saveBrowserDatabase(snapshot: Uint8Array): Promise<void> {
  const database = await openSnapshotDatabase()
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite')
    const done = transactionDone(transaction)
    await requestResult(
      transaction.objectStore(SNAPSHOT_STORE).put(snapshot.slice().buffer, PRIMARY_SNAPSHOT_KEY),
    )
    await done
  }
  finally {
    database.close()
  }
}
