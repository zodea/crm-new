// sql.js 官方包不带类型声明，这里只声明本项目用到的最小 API 面
// （app/lib/db/connection.ts 与 tests/helpers/memory-db.ts）。
declare module 'sql.js' {
  export interface Statement {
    bind(params?: unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, unknown>
    free(): boolean
  }

  export interface Database {
    run(sql: string, params?: unknown[]): Database
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
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
