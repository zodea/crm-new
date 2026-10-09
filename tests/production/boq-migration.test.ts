import type { BoqSourceImportCommand } from '../../app/lib/boq/import-contract'
import type { ConstructionImportCommand } from '../../app/lib/construction-contract/import-contract'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { approveBoqChangeOrder, createBoqChangeOrder, transitionBoqChangeOrder } from '../../app/lib/boq/change'
import { productionBoqWorkspaceProjection } from '../../app/lib/boq/production-projection'
import { runMigrations } from '../../app/lib/db/migrations'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { readProductionBoqImportedIdentities } from '../../server/utils/production-boq-import-evidence'
import { createProductionBoqMigration } from '../../server/utils/production-boq-migration'
import { createProductionBoqService } from '../../server/utils/production-boq-service'
import { validateProductionBoqState } from '../../server/utils/production-boq-validation'
import { createProductionConstructionMigration } from '../../server/utils/production-construction-contract-migration'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createMemoryDb } from '../helpers/memory-db'

it('真实完整SQLite同SHA施工→清单/E/有效变化原图；保SQL扩展/原JSON/原件/缺件，不复制私密整库', async () => {
  const base = resolve('.tmp/opt02-boq')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/migration-`)
  const storage = createProductionStorage({ directory, workspaceId: 'boq-migration-workspace', ownerId: 'boq-migration-owner', purpose: 'verification' })
  const actor = { workspaceId: 'boq-migration-workspace', actorId: 'boq-migration-owner', capabilities: ['boq:read', 'boq:write', 'boq:import', 'owner-document:read', 'owner-document:write', 'core:migration:write', 'construction-contract:read', 'construction-contract:write', 'construction-contract:import', 'customer:list:read', 'customer:write', 'project:list:read', 'project:write'] }
  const session = () => structuredClone(actor)
  const native = await createMemoryDb()
  try {
    const customer = await createProductionCustomerService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-migration-customer', requiredCapability: 'customer:write', baseVersion: null, action: 'draft', draft: { name: '原清单正式甲方' }, attachments: {} }, session)
    const project = await createProductionProjectService(storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-migration-project', requiredCapability: 'project:write', baseVersion: null, action: 'draft', draft: { name: '原清单正式项目', customerId: customer.id }, attachments: {} }, session)
    await runMigrations(native)
    await native.execute('INSERT INTO customers(id,name) VALUES(\'legacy-boq-customer\',\'原甲方\')')
    await native.execute('INSERT INTO projects(id,name,customer_id) VALUES(\'legacy-boq-project\',\'原项目\',\'legacy-boq-customer\')')
    await native.execute('INSERT INTO contracts(id,no,name,kind,project_id,customer_id,amount,status,content,sign_date) VALUES(\'legacy-boq-head\',\'LEGACY-MAIN\',\'原施工主合同\',\'施工\',\'legacy-boq-project\',\'legacy-boq-customer\',NULL,\'已签订\',\'原施工范围\',\'2026-09-01\')')
    await native.execute('ALTER TABLE boq_lines ADD COLUMN future_json TEXT')
    await native.execute('ALTER TABLE boq_lines ADD COLUMN future_integer INTEGER')
    await native.execute('ALTER TABLE boq_lines ADD COLUMN future_blob BLOB')
    await native.execute('INSERT INTO boq_files(id,contract_id,file_name,file_path,format_class,parse_status) VALUES(\'legacy-boq-original\',\'legacy-boq-head\',\'原清单.xlsx\',\'D:/原项目/原清单.xlsx\',\'D\',\'parsed\'),(\'legacy-boq-pricefile\',\'legacy-boq-head\',\'原维修价格.xlsx\',\'\',\'E\',\'parsed\')')
    await native.execute('INSERT INTO boq_lines(id,boq_file_id,project_id,contract_id,item_name,unit,qty,unit_price,recognized_qty,recognized_unit_price,future_json,future_integer,future_blob) VALUES(\'legacy-boq-zero\',\'legacy-boq-original\',\'legacy-boq-project\',\'legacy-boq-head\',\'原零工程量\',\'㎡\',0,17,0,17,?,9223372036854775807,X\'0080FF\'),(\'legacy-boq-unknown\',\'legacy-boq-original\',\'legacy-boq-project\',\'legacy-boq-head\',\'原未知量价\',\'㎡\',NULL,NULL,NULL,NULL,?,NULL,NULL)', ['{"original":"legacy-boq-zero","unknown":7}', '{"original":"legacy-boq-unknown"}'])
    await native.execute('INSERT INTO item_unit_prices(id,project_id,boq_file_id,item_name,unit,unit_price) VALUES(\'legacy-e-price\',\'legacy-boq-project\',\'legacy-boq-pricefile\',\'原维修独立价\',\'次\',0)')
    await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(\'legacy-boq-audit\',\'boq_lines\',\'legacy-boq-zero\',\'update\',?,NULL)', ['{"original":"legacy-boq-zero","unknownAudit":"原记录"}'])
    const quantityChange = await createBoqChangeOrder(native, { projectId: 'legacy-boq-project', contractId: 'legacy-boq-head', code: 'LEGACY-QTY', name: '原已批调量', note: '原明确增2', lines: [{ operation: 'qty', boqLineId: 'legacy-boq-zero', deltaQty: 2 }] })
    await transitionBoqChangeOrder(native, quantityChange.orderId, 'submitted')
    await approveBoqChangeOrder(native, quantityChange.orderId, '2026-09-03')
    const addition = await createBoqChangeOrder(native, { projectId: 'legacy-boq-project', contractId: 'legacy-boq-head', code: 'LEGACY-ADD', name: '原已批新增', note: '原新增3', lines: [{ operation: 'add', itemName: '原新增分项', unit: '㎡', qty: 3, newUnitPrice: 7 }] })
    await transitionBoqChangeOrder(native, addition.orderId, 'submitted')
    await approveBoqChangeOrder(native, addition.orderId, '2026-09-04')
    const embeddedBook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(embeddedBook, XLSX.utils.aoa_to_sheet([['分项名称', '单位', '工程量', '合同单价'], ['原嵌入分项', '㎡', 5, 0]]), '原嵌入清单')
    const embeddedBytes = Buffer.from(XLSX.write(embeddedBook, { type: 'buffer', bookType: 'xlsx' }))
    await native.execute('INSERT INTO boq_files(id,contract_id,file_name,file_path,format_class,parse_status) VALUES(\'legacy-embedded-file\',\'legacy-boq-head\',\'原嵌入.xlsx\',\'\',\'D\',\'parsed\')')
    await native.execute('INSERT INTO boq_lines(id,boq_file_id,project_id,contract_id,item_name,unit,qty,unit_price,recognized_qty,recognized_unit_price) VALUES(\'legacy-embedded-line\',\'legacy-embedded-file\',\'legacy-boq-project\',\'legacy-boq-head\',\'原嵌入分项\',\'㎡\',5,0,5,0)')
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,uploader,category) VALUES(\'legacy-embedded-ref\',\'boq_file\',\'legacy-embedded-file\',\'原嵌入.xlsx\',\'\',?,\'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\',\'原操作者\',\'original_boq\')', [embeddedBytes.length])
    await native.execute('INSERT INTO file_payloads VALUES(\'legacy-embedded-ref\',\'base64\',?)', [embeddedBytes.toString('base64')])
    await native.execute('INSERT INTO owner_change_orders(id,project_id,contract_id,change_no,name,source_type,status,tax_inc_amount,tax_exc_amount,applied_amount,approval_date) VALUES(\'legacy-manual-change\',\'legacy-boq-project\',\'legacy-boq-head\',\'LEGACY-MANUAL\',\'原纯金额签证\',\'manual\',\'approved\',0,0,0,\'\')')
    const manualOriginal = Buffer.from('原纯金额签证完整原件', 'utf8')
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,uploader,category) VALUES(\'legacy-manual-ref\',\'owner_change_order\',\'legacy-manual-change\',\'原纯金额签证.txt\',\'\',?,\'text/plain\',\'原签证人\',\'owner_directive\')', [manualOriginal.length])
    await native.execute('INSERT INTO file_payloads VALUES(\'legacy-manual-ref\',\'base64\',?)', [manualOriginal.toString('base64')])
    await native.execute('UPDATE file_refs SET uploader=NULL,category=NULL,uploaded_at=NULL WHERE id=\'legacy-embedded-ref\'')
    const originalsBefore = await native.select<{ id: string }>('SELECT id FROM boq_lines ORDER BY id')
    await native.execute('CREATE TABLE other_private_domain(secret TEXT)')
    await native.execute('INSERT INTO other_private_domain VALUES(\'DONT_COPY_BOQ_OTHER_PRIVATE_DOMAIN\')')
    const bytes = Buffer.from(native.raw.export())
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
    await writeFile(resolve(directory, 'source-original.db'), bytes)
    const construction = createProductionConstructionMigration(storage)
    const mainCommand: ConstructionImportCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-native-main-adopt', source, projects: [], customers: [], signatories: [], originals: [] }
    const mainPreview = await construction.preflight(mainCommand, session)
    mainCommand.projects = mainPreview.references.filter(row => row.kind === 'project').map(row => ({ legacyId: row.id, id: project.id, version: row.candidates.find(candidate => candidate.id === project.id)!.version }))
    mainCommand.customers = mainPreview.references.filter(row => row.kind === 'customer').map(row => ({ legacyId: row.id, id: customer.id, version: row.candidates.find(candidate => candidate.id === customer.id)!.version }))
    await construction.adopt(mainCommand, session)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['分项名称', '单位', '工程量', '合同单价'], ['原零工程量', '㎡', 0, 17]]), '真实原清单')
    const original = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }))
    const importer = createProductionBoqMigration(storage)
    const command: BoqSourceImportCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-native-graph-adopt', source, heads: [], originals: [{ fileId: 'legacy-boq-original', original: { fileName: '原清单.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileSize: original.length, sha256: createHash('sha256').update(original).digest('hex'), payloadBase64: original.toString('base64') } }] }
    const preview = await importer.preflight(command, session)
    command.heads = preview.heads.map(head => ({ id: head.id, version: head.version }))
    const adopted = await importer.adopt(command, session)
    expect(await importer.adopt(command, session)).toEqual(adopted)
    expect(adopted.lineIds).toEqual(originalsBefore.map(row => row.id))
    const owner = createProductionBoqService(storage)
    const read = await owner.read({ projectId: project.id, contractId: 'legacy-boq-head', origin: 'real' }, session)
    expect(read.lines.map(line => line.id)).toEqual(originalsBefore.map(row => row.id))
    expect(read.lines).toContainEqual(expect.objectContaining({ id: 'legacy-boq-unknown', qty: null, unitPrice: null, recognizedQty: null }))
    expect(read.lines).toContainEqual(expect.objectContaining({ id: 'legacy-boq-zero', qty: 0, unitPrice: 17, recognizedQty: 0, approvedDeltaQty: 2 }))
    expect(read.lines).toContainEqual(expect.objectContaining({ itemName: '原新增分项', qty: 3, unitPrice: 7, eligible: true }))
    expect(read.changes.filter(change => change.document.sourceType === 'boq_change_order').map(change => change.id)).toEqual([addition.orderId, quantityChange.orderId].sort())
    expect(read.changes.find(change => change.id === 'legacy-manual-change')?.document).toMatchObject({ sourceType: 'manual', lines: [], status: 'approved' })
    expect((await owner.file({ projectId: project.id, contractId: 'legacy-boq-head', origin: 'real', ownerKind: 'owner-change', ownerId: 'legacy-manual-change', fileId: 'legacy-manual-ref' }, session)).bytes.equals(manualOriginal)).toBe(true)
    const [manual] = await storage.select<{ record_json: string }>('SELECT record_json FROM boq_change_records WHERE id=\'legacy-manual-change\'')
    expect(JSON.parse(manual!.record_json)).toMatchObject({ id: 'legacy-manual-change', sourceId: 'legacy-manual-change', sourceType: 'manual', legacyLedgerId: 'legacy-manual-change', amount: 0, approvalDate: null, boqAmount: null, lines: [], files: [expect.objectContaining({ id: 'legacy-manual-ref' })] })
    expect(read.prices).toEqual([expect.objectContaining({ id: 'legacy-e-price', unitPrice: 0 })])
    const projection = productionBoqWorkspaceProjection(read, '原项目', '原施工主合同', 'LEGACY-MAIN')
    expect(projection.summary.baseAmount).toBeNull()
    expect(projection.lines.find(line => line.id === 'legacy-boq-zero')?.baseAmount).toBe(0)
    expect(projection.changes.find(change => change.id === 'legacy-manual-change')).toMatchObject({ totalAmount: 0, ledgerId: null })
    const unknownManual = productionBoqWorkspaceProjection({ ...read, changes: read.changes.map(change => change.id === 'legacy-manual-change' ? { ...change, amount: null } : change) }, '原项目', '原施工主合同', 'LEGACY-MAIN')
    expect(unknownManual.changes.find(change => change.id === 'legacy-manual-change')?.totalAmount).toBeNull()
    expect(unknownManual.summary.approvedChangeAmount).toBeNull()
    const [row] = await storage.select<{ evidence_json: string }>('SELECT evidence_json FROM boq_source_imports')
    const evidence = JSON.parse(row!.evidence_json)
    expect(evidence.rawDomain.file_refs.find((row: { legacyId: string }) => row.legacyId === 'legacy-embedded-ref').columns).toMatchObject({ uploader: { sqliteType: 'null', exactValue: null }, category: { sqliteType: 'null', exactValue: null }, uploaded_at: { sqliteType: 'null', exactValue: null } })
    expect(evidence.fileProofs.find((row: { id: string }) => row.id === 'legacy-embedded-ref').originalMetadata).toMatchObject({ uploader: null, category: null, uploaded_at: null })
    expect((await storage.select('SELECT uploader,category,uploaded_at FROM file_refs WHERE id=\'legacy-embedded-ref\''))[0]).toEqual({ uploader: '', category: '', uploaded_at: '' })
    expect(evidence.rawDomain.boq_lines.find((line: { legacyId: string }) => line.legacyId === 'legacy-boq-zero').columns).toMatchObject({ future_json: { exactValue: '{"original":"legacy-boq-zero","unknown":7}' }, future_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' }, future_blob: { sqliteType: 'blob', exactValue: '0080FF' } })
    expect(evidence.rawDomain.operation_logs.find((row: { legacyId: string }) => row.legacyId === 'legacy-boq-audit').columns.after_data.exactValue).toBe('{"original":"legacy-boq-zero","unknownAudit":"原记录"}')
    expect(row!.evidence_json).not.toContain(source.payloadBase64)
    expect(row!.evidence_json).not.toContain('DONT_COPY_BOQ_OTHER_PRIVATE_DOMAIN')
    expect(row!.evidence_json).not.toContain(original.toString('base64'))
    expect(row!.evidence_json).not.toContain(embeddedBytes.toString('base64'))
    expect(evidence.rawDomain.file_payloads.find((row: { legacyId: string }) => row.legacyId === 'legacy-embedded-ref').columns.content).toMatchObject({ sqliteType: 'text', sharedOriginal: 'legacy-embedded-ref', payloadReference: { encoding: 'base64', sha256: createHash('sha256').update(embeddedBytes).digest('hex'), byteLength: embeddedBytes.length, columnSha256: createHash('sha256').update(Buffer.from(embeddedBytes.toString('base64'), 'utf8')).digest('hex') } })
    expect(row!.evidence_json).not.toContain(manualOriginal.toString('base64'))
    expect(Buffer.from((await storage.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=\'legacy-embedded-ref\''))[0]!.content).equals(embeddedBytes)).toBe(true)
    const ids = await storage.withTransaction(tx => readProductionBoqImportedIdentities(tx, source.sha256, actor))
    expect(ids).toContainEqual(expect.objectContaining({ table: 'boq_lines', legacyId: 'legacy-boq-zero', id: 'legacy-boq-zero', projectId: project.id, contractId: 'legacy-boq-head' }))
    expect(ids).toContainEqual(expect.objectContaining({ table: 'boq_change_records', sourceTable: 'owner_change_orders', legacyId: 'legacy-manual-change', id: 'legacy-manual-change', projectId: project.id, contractId: 'legacy-boq-head' }))
    const validation = await storage.withTransaction(tx => validateProductionBoqState(tx))
    expect([...validation.metadataOnlyFileIds]).toEqual([read.files.find(file => file.id === 'legacy-boq-pricefile')!.fileRefId])
    const [blob] = await storage.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [read.files.find(file => file.id === 'legacy-boq-original')!.fileRefId])
    expect(Buffer.from(blob!.content).equals(original)).toBe(true)
    expect((await readFile(resolve(directory, 'source-original.db'))).equals(bytes)).toBe(true)
    const backup = resolve(directory, 'whole-owner-before-restore.sqlite')
    await storage.backupTo(backup)
    const inventory = await inspectProductionBackup(backup)
    expect(inventory.workspaceId).toBe(actor.workspaceId)
    const dangerDirectory = resolve(directory, 'later-business-verification')
    await mkdir(dangerDirectory, { recursive: true })
    await storage.backupTo(resolve(dangerDirectory, 'ruihang.sqlite'))
    const danger = createProductionStorage({ directory: dangerDirectory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
    try {
      const dangerOwner = createProductionBoqService(danger)
      const context = await dangerOwner.read({ projectId: project.id, contractId: 'legacy-boq-head', origin: 'real' }, session)
      await dangerOwner.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-real-later-patch', projectId: project.id, contractId: 'legacy-boq-head', origin: 'real', requiredCapability: 'boq:write', contractVersion: context.contractVersion, action: { kind: 'patch-line', lineId: 'legacy-boq-zero', version: context.lines.find(line => line.id === 'legacy-boq-zero')!.version, patch: { qty: 9 } } }, session)
      const before = await danger.select('SELECT * FROM boq_lines ORDER BY id')
      const importer = createProductionBoqMigration(danger)
      const rejected = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-later-danger-restore', importId: adopted.importId, sourceSha256: source.sha256 }
      await expect(importer.restore(rejected, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await danger.select('SELECT * FROM boq_lines ORDER BY id')).toEqual(before)
      expect(await danger.select('SELECT * FROM boq_import_restores')).toEqual([])
      const descriptor = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: rejected.commandId, family: 'boq-import', action: 'restore', targetId: adopted.importId, scopeId: source.sha256 }
      expect(await importer.resolve(descriptor, session)).toEqual({ outcome: 'not-applied', commandId: rejected.commandId })
      await expect(importer.restore(rejected, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await danger.select('SELECT * FROM boq_lines ORDER BY id')).toEqual(before)
      await expect(importer.resolve({ ...descriptor, scopeId: 'a'.repeat(64) }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    }
    finally { await danger.close() }
    await storage.close()
    const output = resolve(directory, 'cold-adopt.json')
    await promisify(execFile)(process.execPath, [resolve('node_modules/vite-node/dist/cli.mjs'), '--config', resolve('vitest.config.ts'), resolve('tests/helpers/production-boq-cold.ts'), directory, JSON.stringify(actor), JSON.stringify({ projectId: project.id, contractId: 'legacy-boq-head', origin: 'real' }), JSON.stringify({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: command.commandId, family: 'boq-import', action: 'adopt', targetId: source.sha256, scopeId: source.sha256 }), output], { windowsHide: true })
    const cold = JSON.parse(await readFile(output, 'utf8'))
    expect(cold.resolution).toEqual({ outcome: 'applied', result: adopted })
    expect(cold.workspace.lines).toEqual(read.lines)
    expect((await readFile(cold.originals.find((file: { fileRefId: string }) => file.fileRefId === 'legacy-embedded-ref').path)).equals(embeddedBytes)).toBe(true)
    expect((await readFile(cold.originals.find((file: { fileRefId: string }) => file.fileRefId === 'legacy-manual-ref').path)).equals(manualOriginal)).toBe(true)
    const restore = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'boq-native-graph-restore', importId: adopted.importId, sourceSha256: source.sha256 }
    const restored = await importer.restore(restore, session)
    expect(restored).toMatchObject({ importId: adopted.importId, sourceSha256: source.sha256, restored: true })
    expect(await importer.restore(restore, session)).toEqual(restored)
    expect(await importer.resolve({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: restore.commandId, family: 'boq-import', action: 'restore', targetId: adopted.importId, scopeId: source.sha256 }, session)).toEqual({ outcome: 'applied', result: restored })
    await expect(storage.withTransaction(tx => readProductionBoqImportedIdentities(tx, source.sha256, actor))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect((await owner.read({ projectId: project.id, contractId: 'legacy-boq-head', origin: 'real' }, session)).lines).toEqual([])
    expect(Buffer.from((await storage.select<{ content: Uint8Array }>('SELECT content FROM file_payloads WHERE file_ref_id=?', [read.files.find(file => file.id === 'legacy-boq-original')!.fileRefId]))[0]!.content).equals(original)).toBe(true)
    expect((await readFile(resolve(directory, 'source-original.db'))).equals(bytes)).toBe(true)
    await storage.withTransaction(tx => validateProductionBoqState(tx))
    const recoveredBackup = resolve(directory, 'whole-owner-after-restore.sqlite')
    await storage.backupTo(recoveredBackup)
    expect((await inspectProductionBackup(recoveredBackup)).workspaceId).toBe(actor.workspaceId)
  }
  finally {
    native.close()
    await storage.close()
  }
}, 30_000)
