// sql.js 官方包不带类型声明，这里只声明本项目用到的最小 API 面
// （包括应用数据库连接、测试内存库和浏览器测试夹具）。
declare module 'sql.js' {
  export interface Statement {
    bind: (params?: unknown[]) => boolean
    step: () => boolean
    getAsObject: () => Record<string, unknown>
    free: () => boolean
  }

  export interface Database {
    run: (sql: string, params?: unknown[]) => Database
    exec: (sql: string, params?: unknown[] | Record<string, unknown>) => Array<{
      columns: string[]
      values: Array<Array<string | number | null | Uint8Array>>
    }>
    prepare: (sql: string) => Statement
    export: () => Uint8Array
    close: () => void
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => Database
  }

  export interface InitSqlJsConfig {
    wasmBinary?: ArrayBuffer
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>
}
