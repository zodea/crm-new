import type { SQLInputValue } from 'node:sqlite'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { INVOICE_WRITE_CAPABILITY } from '~/lib/invoice/central-contract'
import { createCentralInvoiceHttp } from '~/lib/invoice/central-http'
import { createCentralInvoiceWorkspace } from '~/lib/invoice/central-workspace'
import { PRODUCTION_INVOICE_SCHEMA } from '../../server/utils/production-invoice-schema'
import { createProductionInvoiceService } from '../../server/utils/production-invoice-service'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('真实合成内存服务的 101 张票经 HTTP 适配器和工作区完整分页', async () => {
  const sql = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  sql.exec(`CREATE TABLE production_participants(domain TEXT PRIMARY KEY,schema_version INTEGER NOT NULL);
    CREATE TABLE projects(id TEXT PRIMARY KEY,deleted_at TEXT);
    CREATE TABLE suppliers(id TEXT PRIMARY KEY,draft_json TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE payment_application_invoice_allocations(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,file_name TEXT NOT NULL,file_size INTEGER NOT NULL,mime_type TEXT NOT NULL,category TEXT NOT NULL,uploader TEXT NOT NULL,uploaded_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),content BLOB NOT NULL,sha256 TEXT NOT NULL);`)
  sql.exec(PRODUCTION_INVOICE_SCHEMA)
  const coordinator = createDbCoordinator(async () => ({
    async execute(statement, params) {
      if (params)
        sql.prepare(statement).run(...params as SQLInputValue[])
      else sql.exec(statement)
    },
    async select<T>(statement: string, params: unknown[] = []) {
      return sql.prepare(statement).all(...params as SQLInputValue[]) as T[]
    },
    async close() { sql.close() },
  }))
  const identity = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-actor' }
  const actor = { ...identity, capabilities: ['finance-invoice:read', 'finance-invoice:write'] }
  const storage = { ...coordinator, identity, assertBusinessWrite() {} } as ProductionStorage
  try {
    const service = createProductionInvoiceService(storage)
    const fields = { invoiceNumber: '', invoiceDate: '', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '', sellerTaxNo: '', amount: null, taxAmount: 0, totalAmount: null, taxRate: '', remark: '' }
    const ids = []
    for (let i = 0; i < 101; i++) {
      const result = await service.execute({ ...identity, requiredCapability: INVOICE_WRITE_CAPABILITY, action: 'manual', commandId: `synthetic-command-${i}`, baseVersion: null, fields: { ...fields, invoiceNumber: `SYN-${i}` }, items: [] }, () => actor)
      ids.push(result.invoiceId)
    }
    const pages: Array<{ page: number, fingerprint: string, sourceVersion: string | null }> = []
    let detailGate: { entered: ReturnType<typeof deferred>, release: ReturnType<typeof deferred> } | null = null
    const client = createCentralInvoiceHttp(async (url, options) => {
      if (url === '/api/read/invoices') {
        const result = await service.listRead(options?.query ?? {}, () => actor)
        pages.push({ page: result.pagination.page, fingerprint: result.meta.authorizedScope.fingerprint, sourceVersion: result.sourceVersion })
        return result
      }
      if (url === '/api/commands/invoices')
        return service.execute(options?.body, () => actor)
      if (url.startsWith('/api/read/invoices/')) {
        const id = decodeURIComponent(url.slice('/api/read/invoices/'.length))
        const result = await service.getRead(id, () => actor, options?.query?.deleted === 'true')
        if (detailGate) {
          const currentGate = detailGate
          detailGate = null
          currentGate.entered.resolve()
          await currentGate.release.promise
        }
        return result
      }
      throw new Error('拒绝非合成读取')
    }, identity)
    const values = new Map<string, string>()
    const recoveryStorage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    })
    let command = 0
    const workspace = createCentralInvoiceWorkspace({ identity, client, context: async () => actor, commandId: () => `synthetic-workspace-command-${++command}`, storage: recoveryStorage, recognizeLocal: async () => {
      throw new Error('未使用识别')
    } })
    await workspace.load()
    expect(workspace.readState.value).toBe('ready')
    expect(workspace.records.value).toHaveLength(101)
    expect(new Set(workspace.records.value.map(row => row.id))).toEqual(new Set(ids))
    expect(pages.map(page => page.page)).toEqual([1, 2])
    expect(pages[0]!.fingerprint).not.toBe(pages[1]!.fingerprint)
    expect(pages[0]!.sourceVersion).toBe(pages[1]!.sourceVersion)
    const target = workspace.records.value[0]!
    const discardedGate = { entered: deferred(), release: deferred() }
    detailGate = discardedGate
    const discarded = workspace.discard(target)
    await discardedGate.entered.promise
    await workspace.load()
    expect(workspace.records.value).toHaveLength(100)
    expect(workspace.records.value.some(row => row.id === target.id)).toBe(false)
    discardedGate.release.resolve()
    const deleted = await discarded
    expect(deleted.deletedAt).not.toBeNull()
    expect(workspace.pending(target.id)).toBeNull()
    expect(workspace.readState.value).toBe('ready')
    expect(workspace.records.value).toHaveLength(100)
    const restoredGate = { entered: deferred(), release: deferred() }
    detailGate = restoredGate
    const restored = workspace.restore(deleted)
    await restoredGate.entered.promise
    await workspace.load()
    expect(workspace.records.value).toHaveLength(101)
    restoredGate.release.resolve()
    expect((await restored).deletedAt).toBeNull()
    expect(workspace.pending(target.id)).toBeNull()
    expect(workspace.readState.value).toBe('ready')
    expect(workspace.records.value).toHaveLength(101)
  }
  finally {
    await coordinator.close()
  }
})
