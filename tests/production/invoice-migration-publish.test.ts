import type { SQLInputValue } from 'node:sqlite'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createCentralInvoiceHttp } from '../../app/lib/invoice/central-http'
import { createInvoiceMigrationSession } from '../../app/lib/invoice/central-migration'
import { verifyBackupOriginalOwner, verifyInvoiceOriginalReferences } from '../../server/utils/production-backup-manifest'
import { createProductionInvoiceMigration } from '../../server/utils/production-invoice-migration'
import { createProductionInvoiceService, listProductionInvoiceReferences, validateProductionInvoiceJournal } from '../../server/utils/production-invoice-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { testTempRoot } from '../helpers/test-temp-root'

it('完整旧库原子发布：保留旧身份、缺失原件、模糊零和不可变证据，原编号重放', async () => {
  const native = await createMigratedMemoryDb()
  let bytes: Uint8Array
  let badBytes: Uint8Array
  try {
    await native.execute(`INSERT INTO invoices(id,file_name,file_path,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items) VALUES ('legacy-invoice-one','missing.pdf','','scan','SYN-01','2026-01-01','合成销方',0,0,100,'pending','unreviewed','none','normal',0,0,'[]')`)
    await native.execute('UPDATE invoices SET items=? WHERE id=?', [JSON.stringify([{ name: '合成明细', spec: '', unit: '', quantity: 0, unitPrice: 2, amount: 0, taxRate: '', taxAmount: 0 }]), 'legacy-invoice-one'])
    await native.execute(`INSERT INTO invoices(id,file_name,file_path,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items) VALUES ('legacy-invoice-two','original.png','','scan','SYN-02','2026-01-01','合成销方',0,0,50,'pending','unreviewed','none','normal',0,0,'[]')`)
    await native.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES('legacy-original','invoice','legacy-invoice-two','original.png','',8,'image/png')`)
    await native.execute(`INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES('legacy-original','base64','iVBORw0KGgo=')`)
    bytes = native.raw.export()
    await native.execute(`INSERT INTO invoices(id,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items) VALUES ('legacy-invoice-three','scan','SYN-03','2026-01-01','合成销方',0,0,100,'pending','unreviewed','none','normal',0,0,'invalid-json')`)
    badBytes = native.raw.export()
  }
  finally { native.close() }
  const base = testTempRoot('invoice-migration-publish')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'invoice-import-workspace', ownerId: 'synthetic-owner', purpose: 'verification' })
  const actor = { ...storage.identity, capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  const session = () => actor
  try {
    const migration = createProductionInvoiceMigration(storage)
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const request = { ...storage.identity, commandId: 'synthetic-legacy-publish', source, mappings: { projects: [], suppliers: [], contracts: [] }, confirmed: true }
    const badSource = { sha256: createHash('sha256').update(badBytes).digest('hex'), payloadBase64: Buffer.from(badBytes).toString('base64') }
    await expect(migration.publish({ ...request, commandId: 'synthetic-bad-batch', source: badSource }, session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await storage.select('SELECT id FROM invoices')).toEqual([])
    expect(await storage.select('SELECT id FROM invoice_legacy_batches')).toEqual([])
    let calls = 0
    await expect(migration.publish({ ...request, commandId: 'synthetic-revoked-batch' }, () => ++calls < 3 ? actor : { ...actor, capabilities: [] })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await storage.select('SELECT id FROM invoices')).toEqual([])
    const result = await migration.publish(request, session)
    expect(result.invoiceIds).toEqual(['legacy-invoice-one', 'legacy-invoice-two'])
    expect(await migration.publish(request, session)).toEqual(result)
    expect((await migration.state(session)).batches).toMatchObject([{ batchId: result.batchId, invoiceIds: result.invoiceIds, retiredAt: null }])
    const pending = new Map<string, string>()
    let clientPermitted = true
    const clientSession = createInvoiceMigrationSession({ identity: actor, context: async () => clientPermitted ? actor : { ...actor, capabilities: [] }, commandId: () => request.commandId, storage: () => ({
      getItem: key => pending.get(key) ?? null,
      setItem: (key, value) => { pending.set(key, value) },
      removeItem: (key) => { pending.delete(key) },
    }), fetcher: async (url, options) => {
      if (url.endsWith('/migration-publish')) {
        await migration.publish(options?.body, session)
        throw new Error('合成连接中断')
      }
      if (url.endsWith('/migration-resolve'))
        return migration.resolve(options?.body, session)
      return migration.state(session)
    } })
    await expect(clientSession.publish(source, request.mappings)).rejects.toThrow('合成连接中断')
    expect(clientSession.pending(null)?.commandId).toBe(request.commandId)
    expect(JSON.stringify([...pending.values()])).not.toContain(source.payloadBase64)
    clientPermitted = false
    await expect(clientSession.recover(null)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(clientSession.pending(null)?.commandId).toBe(request.commandId)
    clientPermitted = true
    expect(await clientSession.recover(null)).toEqual({ outcome: 'applied', result })
    expect(clientSession.pending(null)).toBeNull()
    expect(await migration.resolve({ ...storage.identity, commandId: request.commandId }, session)).toEqual({ outcome: 'applied', result })
    expect(await migration.resolve({ ...storage.identity, commandId: 'sealed-legacy' }, session)).toEqual({ outcome: 'not-applied', commandId: 'sealed-legacy' })
    await expect(migration.publish({ ...request, commandId: 'sealed-legacy' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const invoice = await createProductionInvoiceService(storage).get('legacy-invoice-one', session)
    expect(invoice).toMatchObject({ id: 'legacy-invoice-one', sourceKind: 'legacy', original: null, fields: { amount: null, taxAmount: null, totalAmount: 100 }, items: [{ quantity: null, unitPrice: 2, amount: null }], legacy: { source: 'scan', originalState: 'session-original-unavailable', ambiguousZeroFields: ['amount', 'tax_amount'], ambiguousItemNumbers: true } })
    const client = createCentralInvoiceHttp(async (_url, options) => createProductionInvoiceService(storage).listRead(options?.query ?? {}, session), actor)
    expect((await client.list({ page: 1, pageSize: 20 })).items).toMatchObject([{ id: 'legacy-invoice-one', legacy: { originalState: 'session-original-unavailable' } }, { id: 'legacy-invoice-two', legacy: { originalState: 'recorded' } }])
    const file = await createProductionInvoiceService(storage).original('legacy-invoice-two', 'legacy-original', session)
    expect(Buffer.from(file.bytes).toString('base64')).toBe('iVBORw0KGgo=')
    await expect(validateProductionInvoiceJournal(storage, actor)).resolves.toBeUndefined()
    const member = (await storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_legacy_members'))[0]!
    expect(JSON.parse(member.evidence_json).entry.sourceHead).toMatchObject({ id: 'legacy-invoice-one', amount: 0, tax_amount: 0 })
    await expect(migration.publish({ ...request, commandId: 'different-command' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const retire = { ...storage.identity, commandId: 'synthetic-legacy-retire', batchId: result.batchId, confirmed: true }
    await storage.execute(`INSERT INTO payment_applications(id) VALUES('synthetic-history')`)
    await storage.execute(`INSERT INTO payment_application_invoice_allocations(id,payment_application_id,invoice_id,allocated_amount,deleted_at) VALUES('synthetic-allocation','synthetic-history','legacy-invoice-one',10,'2026-01-01T00:00:00Z')`)
    await expect(migration.retire(retire, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await createProductionInvoiceService(storage).get('legacy-invoice-one', session)).version).toBe('1')
    await storage.execute(`DELETE FROM payment_application_invoice_allocations WHERE id='synthetic-allocation'`)
    await storage.execute(`DELETE FROM payment_applications WHERE id='synthetic-history'`)
    let readFailure = true
    const retirementSession = createInvoiceMigrationSession({
      identity: actor,
      context: async () => actor,
      commandId: () => retire.commandId,
      storage: () => ({
        getItem: key => pending.get(key) ?? null,
        setItem: (key, value) => { pending.set(key, value) },
        removeItem: (key) => { pending.delete(key) },
      }),
      fetcher: async (url, options) => {
        if (url.endsWith('/migration-retire'))
          return migration.retire(options?.body, session)
        if (url.endsWith('/migration-resolve'))
          return migration.resolve(options?.body, session)
        if (readFailure)
          throw new Error('合成回读失败')
        return migration.state(session)
      },
    })
    await expect(retirementSession.retire(result.batchId)).rejects.toThrow('合成回读失败')
    expect(retirementSession.pending(result.batchId)?.commandId).toBe(retire.commandId)
    readFailure = false
    const recoveredRetirement = await retirementSession.recover(result.batchId)
    expect(recoveredRetirement.outcome).toBe('applied')
    if (recoveredRetirement.outcome !== 'applied')
      throw new Error('应已恢复原批次')
    const retired = recoveredRetirement.result
    expect(retired).toMatchObject({ batchId: result.batchId, invoiceIds: ['legacy-invoice-one', 'legacy-invoice-two'], retired: true })
    expect(await migration.retire(retire, session)).toEqual(retired)
    expect(await migration.resolve({ ...storage.identity, commandId: retire.commandId }, session)).toEqual({ outcome: 'applied', result: retired })
    expect((await migration.state(session)).batches).toMatchObject([{ batchId: result.batchId, retiredAt: retired.createdAt }])
    await expect(createProductionInvoiceService(storage).get('legacy-invoice-one', session)).rejects.toMatchObject({ problem: { code: 'not-found' } })
    await expect(validateProductionInvoiceJournal(storage, actor)).resolves.toBeUndefined()
    await expect(createProductionInvoiceService(storage).execute({ ...storage.identity, requiredCapability: 'finance-invoice:write', action: 'restore', commandId: 'unsafe-revive', invoiceId: 'legacy-invoice-one', baseVersion: '2' }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(JSON.parse((await storage.select<{ evidence_json: string }>('SELECT evidence_json FROM invoice_legacy_members'))[0]!.evidence_json)).toMatchObject({ entry: { sourceHead: { id: 'legacy-invoice-one', amount: 0 } } })
    const laterSource = await createMigratedMemoryDb()
    let laterBytes: Uint8Array
    try {
      await laterSource.execute(`INSERT INTO invoices(id,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,print_count,print_rotation,items) VALUES ('legacy-later','scan','SYN-04','2026-01-01','合成销方',0,0,50,'pending','unreviewed','none','normal',0,0,'[]')`)
      laterBytes = laterSource.raw.export()
    }
    finally { laterSource.close() }
    const later = await migration.publish({ ...request, commandId: 'later-publish', source: { sha256: createHash('sha256').update(laterBytes).digest('hex'), payloadBase64: Buffer.from(laterBytes).toString('base64') } }, session)
    const invoiceService = createProductionInvoiceService(storage)
    const beforeEdit = await invoiceService.get('legacy-later', session)
    const edited = await invoiceService.execute({ ...storage.identity, requiredCapability: 'finance-invoice:write', action: 'edit', commandId: 'later-edit', invoiceId: beforeEdit.id, baseVersion: beforeEdit.version, fields: { ...beforeEdit.fields, remark: '后来人工更正' }, items: beforeEdit.items }, session)
    await expect(migration.retire({ ...storage.identity, commandId: 'later-retire', batchId: later.batchId, confirmed: true }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await invoiceService.get(beforeEdit.id, session)).version).toBe(edited.version)
    await expect(validateProductionInvoiceJournal(storage, actor)).resolves.toBeUndefined()
    const archivedSource = await createMigratedMemoryDb()
    let archivedBytes: Uint8Array
    let archivedAllocation: Record<string, unknown>
    try {
      await archivedSource.execute(`INSERT INTO invoices(id,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,ocr_status,review_status,account_status,dup_status,owner_kind,archived_at,print_count,print_rotation,items) VALUES ('legacy-archived','excel','SYN-05','2026-01-01','合成销方',0,0,50,'done','reviewed','archived','normal','personal','2026-01-01T00:00:00.000Z',0,0,'[]')`)
      await archivedSource.execute(`INSERT INTO payment_applications(id) VALUES('legacy-payment')`)
      await archivedSource.execute(`INSERT INTO payment_application_invoice_allocations(id,payment_application_id,invoice_id,allocated_amount,note) VALUES('legacy-allocation','legacy-payment','legacy-archived',20,'旧分摊依据')`)
      archivedAllocation = (await archivedSource.select<Record<string, unknown>>('SELECT * FROM payment_application_invoice_allocations WHERE id=?', ['legacy-allocation']))[0]!
      archivedBytes = archivedSource.raw.export()
    }
    finally { archivedSource.close() }
    await storage.execute(`INSERT INTO payment_applications(id) VALUES('legacy-payment')`)
    await storage.execute('INSERT INTO payment_application_invoice_allocations(id,payment_application_id,invoice_id,allocated_amount,note,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)', ['legacy-allocation', 'legacy-payment', 'legacy-archived', archivedAllocation.allocated_amount, archivedAllocation.note, archivedAllocation.created_at, archivedAllocation.updated_at, archivedAllocation.deleted_at])
    const archivedBatch = await migration.publish({ ...request, commandId: 'archive-publish', source: { sha256: createHash('sha256').update(archivedBytes).digest('hex'), payloadBase64: Buffer.from(archivedBytes).toString('base64') } }, session)
    const archived = await invoiceService.get('legacy-archived', session)
    expect(archived).toMatchObject({ completionMethod: 'legacy', ocrStatus: 'pending', accountStatus: 'archived' })
    expect(await storage.select('SELECT invoice_id,allocated_amount,note FROM payment_application_invoice_allocations WHERE id=?', ['legacy-allocation'])).toEqual([{ invoice_id: 'legacy-archived', allocated_amount: 20, note: '旧分摊依据' }])
    await expect(migration.retire({ ...storage.identity, commandId: 'archive-retire', batchId: archivedBatch.batchId, confirmed: true }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(storage.withTransaction(tx => listProductionInvoiceReferences(tx, actor, archived.id))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const confirmed = await invoiceService.execute({ ...storage.identity, requiredCapability: 'finance-invoice:write', action: 'confirm-legacy', commandId: 'confirm-old-archive', invoiceId: archived.id, baseVersion: archived.version, confirmed: true }, session)
    expect((await invoiceService.get(archived.id, session)).completionMethod).toBe('manual')
    expect(await storage.withTransaction(tx => listProductionInvoiceReferences(tx, actor, archived.id))).toMatchObject([{ id: archived.id, total_amount: 50 }])
    expect(confirmed.version).toBe('2')
    await expect(validateProductionInvoiceJournal(storage, actor)).resolves.toBeUndefined()
    const coldPath = join(directory, 'synthetic-cold.sqlite')
    await storage.backupTo(coldPath)
    const cold = new DatabaseSync(coldPath, { readOnly: true, enableForeignKeyConstraints: true })
    try {
      const tx = {
        async select<T>(sql: string, params: unknown[] = []) { return cold.prepare(sql).all(...params as SQLInputValue[]) as T[] },
      }
      await expect(validateProductionInvoiceJournal(tx, actor)).resolves.toBeUndefined()
      expect(() => verifyInvoiceOriginalReferences(cold)).not.toThrow()
      for (const file of cold.prepare(`SELECT * FROM file_refs WHERE owner_type='invoice'`).all())
        expect(() => verifyBackupOriginalOwner(cold, file, new Set())).not.toThrow()
    }
    finally { cold.close() }
    const child = `const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1],{readOnly:true}); const invoice=db.prepare('SELECT source_kind,version,deleted_at FROM invoices WHERE id=?').get('legacy-invoice-two'); const bytes=db.prepare('SELECT content FROM file_payloads WHERE file_ref_id=?').get('legacy-original').content; const batches=db.prepare('SELECT COUNT(*) AS n FROM invoice_legacy_batches').get(); process.stdout.write(JSON.stringify({invoice,body:Buffer.from(bytes).toString('base64'),batches:batches.n})); db.close()`
    const coldRead = JSON.parse(execFileSync(process.execPath, ['-e', child, coldPath], { encoding: 'utf8' }))
    expect(coldRead).toMatchObject({ invoice: { source_kind: 'legacy', version: 2 }, body: 'iVBORw0KGgo=', batches: 3 })
    const damaged = new DatabaseSync(coldPath)
    try {
      damaged.exec(`DROP TRIGGER invoice_legacy_members_no_update; UPDATE invoice_legacy_members SET evidence_json=json_set(evidence_json,'$.entry.sourceHead.amount',999) WHERE invoice_id='legacy-invoice-one'`)
      const tx = {
        async select<T>(sql: string, params: unknown[] = []) { return damaged.prepare(sql).all(...params as SQLInputValue[]) as T[] },
      }
      await expect(validateProductionInvoiceJournal(tx, actor)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    }
    finally { damaged.close() }
  }
  finally { await storage.close() }
})
