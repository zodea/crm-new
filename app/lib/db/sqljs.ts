/// <reference path="../../types/sql.js.d.ts" />

interface SqlJsStatement {
  bind: (params?: unknown[]) => boolean
  step: () => boolean
  getAsObject: () => Record<string, unknown>
  free: () => boolean
}

export interface BrowserSqliteDatabase {
  run: (sql: string, params?: unknown[]) => BrowserSqliteDatabase
  prepare: (sql: string) => SqlJsStatement
  export: () => Uint8Array
  close: () => void
}

interface BrowserSqlJsRuntime {
  Database: new (data?: ArrayLike<number> | null) => BrowserSqliteDatabase
}

type InitBrowserSqlJs = (config: { wasmBinary: ArrayBuffer }) => Promise<BrowserSqlJsRuntime>

let runtime: Promise<BrowserSqlJsRuntime> | null = null

export async function loadBrowserSqlJs(): Promise<BrowserSqlJsRuntime> {
  if (!runtime) {
    runtime = (async () => {
      const [initSqlJs, wasmResponse] = await Promise.all([
        import('sql.js').then(module => module.default as InitBrowserSqlJs),
        fetch('/sql-wasm.wasm'),
      ])
      if (!wasmResponse.ok)
        throw new Error(`sql.js wasm 加载失败：${wasmResponse.status}`)
      return initSqlJs({ wasmBinary: await wasmResponse.arrayBuffer() })
    })()
    void runtime.catch(() => {
      runtime = null
    })
  }
  return runtime
}

export async function openBrowserSqlite(snapshot?: Uint8Array | null): Promise<BrowserSqliteDatabase> {
  const SQL = await loadBrowserSqlJs()
  return snapshot ? new SQL.Database(snapshot) : new SQL.Database()
}
