import type { SQLInputValue } from 'node:sqlite'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, PRODUCTION_STORAGE_VERSION } from '../../server/utils/production-storage-schema'
import { testTempRoot } from '../helpers/test-temp-root'

it('正式登记的发票 owner 备份和隔离恢复保留迁入证据、原回执与原件', async () => {
  const { createMigratedMemoryDb } = await import('../helpers/memory-db')
  const { createProductionStorage } = await import('../../server/utils/production-storage')
  const { createProductionInvoiceMigration } = await import('../../server/utils/production-invoice-migration')
  const { createProductionInvoiceService } = await import('../../server/utils/production-invoice-service')
  const { createLocalBackup, restoreBackupIsolated } = await import('../../server/utils/production-backup-package')
  const native = await createMigratedMemoryDb()
  let bytes: Uint8Array
  try {
    await native.execute(`INSERT INTO invoices(id,file_name,file_path,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items) VALUES ('legacy-backup','original.png','','scan','SYN-88','2026-01-01','合成销方',0,0,100,'pending','unreviewed','none','normal',0,0,'[]')`)
    await native.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES('legacy-backup-file','invoice','legacy-backup','original.png','',8,'image/png')`)
    await native.execute(`INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES('legacy-backup-file','base64','iVBORw0KGgo=')`)
    bytes = native.raw.export()
  }
  finally { native.close() }
  const base = testTempRoot('invoice-migration-backup')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const sourceDirectory = join(directory, 'source')
  const backupDirectory = join(directory, 'backup')
  const restoreDirectory = join(directory, 'restore')
  await Promise.all([mkdir(sourceDirectory), mkdir(backupDirectory), mkdir(restoreDirectory)])
  const options = { directory: sourceDirectory, workspaceId: 'invoice-backup-workspace', ownerId: 'synthetic-owner', purpose: 'verification' as const }
  const original = new DatabaseSync(join(sourceDirectory, 'ruihang.sqlite'), { enableForeignKeyConstraints: true })
  original.exec('BEGIN')
  original.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 29)) original.exec(upgrade.sql)
  original.prepare('INSERT INTO production_metadata VALUES(1,29,?,?,?,?)').run(options.workspaceId, options.ownerId, options.purpose, '2026-01-01T00:00:00.000Z')
  original.exec('COMMIT')
  const coordinator = createDbCoordinator(async () => ({
    async execute(sql, params) {
      if (params)
        original.prepare(sql).run(...params as SQLInputValue[])
      else
        original.exec(sql)
    },
    async select<T>(sql: string, params: unknown[] = []) { return original.prepare(sql).all(...params as SQLInputValue[]) as T[] },
    async close() { original.close() },
  }))
  const oldStorage = { ...coordinator, identity: { workspaceId: options.workspaceId, actorId: options.ownerId }, assertBusinessWrite() {} } as ProductionStorage
  let oldClosed = false
  let storage: ReturnType<typeof createProductionStorage> | null = null
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const session = () => actor
  let restoredStorage: ReturnType<typeof createProductionStorage> | null = null
  try {
    const request = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'legacy-backup-publish', confirmed: true, mappings: { projects: [], suppliers: [], contracts: [] }, source: { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') } }
    const result = await createProductionInvoiceMigration(oldStorage).publish(request, session)
    const oldRows = await oldStorage.select('SELECT * FROM invoices WHERE id=?', ['legacy-backup'])
    await oldStorage.close()
    oldClosed = true
    storage = createProductionStorage(options)
    expect((await storage.status()).schemaVersion).toBe(PRODUCTION_STORAGE_VERSION)
    expect(await storage.select('SELECT * FROM invoices WHERE id=?', ['legacy-backup'])).toEqual(oldRows)
    expect(await createProductionInvoiceMigration(storage).resolve({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: request.commandId }, session)).toEqual({ outcome: 'applied', result })
    const backup = await createLocalBackup(storage, backupDirectory, `backup-${randomUUID()}`, () => new Date().toISOString())
    expect(backup.inventory.schemaVersion).toBe(PRODUCTION_STORAGE_VERSION)
    expect(backup.inventory.participants).toHaveProperty('invoices')
    const restored = await restoreBackupIsolated(backupDirectory, backup.id, restoreDirectory, 'invoice-restore-check')
    expect(restored.inventory).toEqual(backup.inventory)
    restoredStorage = createProductionStorage({ ...options, directory: restored.directory })
    const migration = createProductionInvoiceMigration(restoredStorage)
    expect(await migration.resolve({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: request.commandId }, session)).toEqual({ outcome: 'applied', result })
    expect(await migration.publish(request, session)).toEqual(result)
    const invoices = createProductionInvoiceService(restoredStorage)
    expect(await invoices.get('legacy-backup', session)).toMatchObject({ sourceKind: 'legacy', fields: { amount: null, taxAmount: null, totalAmount: 100 }, legacy: { originalState: 'recorded' } })
    expect(Buffer.from((await invoices.original('legacy-backup', 'legacy-backup-file', session)).bytes).toString('base64')).toBe('iVBORw0KGgo=')
    await restoredStorage.close()
    const child = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});const meta=db.prepare('SELECT schema_version FROM production_metadata').get();const row=db.prepare('SELECT i.id,i.source_kind,p.content FROM invoices i JOIN file_payloads p ON p.file_ref_id=i.original_file_id WHERE i.id=?').get('legacy-backup');const receipt=db.prepare('SELECT result_json FROM invoice_legacy_commands WHERE command_id=?').get('legacy-backup-publish');process.stdout.write(JSON.stringify({version:meta.schema_version,id:row.id,source:row.source_kind,body:Buffer.from(row.content).toString('base64'),receipt:JSON.parse(receipt.result_json),foreignKeys:db.prepare('PRAGMA foreign_key_check').all()}));db.close()`
    const cold = JSON.parse(execFileSync(process.execPath, ['-e', child, join(restored.directory, 'ruihang.sqlite')], { encoding: 'utf8' }))
    expect(cold).toEqual({ version: PRODUCTION_STORAGE_VERSION, id: 'legacy-backup', source: 'legacy', body: 'iVBORw0KGgo=', receipt: result, foreignKeys: [] })
  }
  finally {
    if (!oldClosed)
      await oldStorage.close()
    if (restoredStorage)
      await restoredStorage.close()
    if (storage)
      await storage.close()
  }
})
