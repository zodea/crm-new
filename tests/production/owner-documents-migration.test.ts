import type { BoqSourceImportCommand } from '../../app/lib/boq/import-contract'
import type { ConstructionImportCommand } from '../../app/lib/construction-contract/import-contract'
import type { OwnerDocumentMigrationCommand } from '../../app/lib/owner-document/production-migration'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ownerDocumentMigrationDescriptor } from '../../app/lib/owner-document/production-migration'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createProductionBoqMigration } from '../../server/utils/production-boq-migration'
import { createProductionConstructionMigration } from '../../server/utils/production-construction-contract-migration'
import { createProductionOtherSettlementMigration } from '../../server/utils/production-other-settlement-migration'
import { createProductionOwnerDocumentMigration } from '../../server/utils/production-owner-document-migration'
import { createProductionOwnerDocumentService } from '../../server/utils/production-owner-document-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { runColdProcess } from '../helpers/cold-process'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { createSubcontractFixture } from '../helpers/production-subcontract-fixture'

async function fixture(withOther = false) {
  const f = await createSubcontractFixture()
  const actor = f.session()
  actor.capabilities.push('owner-document:import', 'owner-document:read', 'owner-document:write', 'subcontract-document:read', 'subcontract-document:write', 'crew:list:read', 'boq:read')
  f.setActor(actor)
  const sub = await f.service.execute(f.command(), f.session)
  let auxiliary: { id: string } | null = null
  if (withOther) {
    actor.capabilities.push('auxiliary-contract:read', 'auxiliary-contract:write', 'other-settlement:read', 'other-settlement:write', 'core:migration:write')
    f.setActor(actor)
    auxiliary = await createProductionAuxiliaryContractService(f.storage).execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'auxiliary-contract:write', commandId: 'business-actual-auxiliary', baseVersion: null, action: 'draft', constructionMain: f.constructionMain, draft: { kind: 'other_expense', no: 'ACTUAL-AUX', name: '实际其他支出合同', category: '检测服务', projectId: f.project.id, supplierId: f.supplier.id, signDate: '2026-10-07', amount: 100, taxRate: 0, ourSignatoryId: f.signatory.id, ourSignatoryVersion: f.signatory.version }, attachments: {} }, f.session)
  }
  const native = await createMigratedMemoryDb()
  native.raw.exec('INSERT INTO customers(id,name) VALUES(\'native-customer\',\'原甲方\'); INSERT INTO suppliers(id,name) VALUES(\'native-supplier\',\'原分供方\'); INSERT INTO projects(id,name,customer_id) VALUES(\'native-project\',\'原项目\',\'native-customer\')')
  native.raw.exec('INSERT INTO contracts(id,name,no,kind,project_id,customer_id,status) VALUES(\'native-main\',\'原施工\',\'NATIVE-MAIN\',\'施工\',\'native-project\',\'native-customer\',\'已签订\'); INSERT INTO contracts(id,name,no,kind,project_id,supplier_id,status) VALUES(\'native-sub\',\'原分包\',\'NATIVE-SUB\',\'分包\',\'native-project\',\'native-supplier\',\'已签订\')')
  native.raw.exec('ALTER TABLE project_acceptances ADD COLUMN unknown_text TEXT; ALTER TABLE project_acceptances ADD COLUMN unknown_integer INTEGER; ALTER TABLE project_acceptances ADD COLUMN unknown_blob BLOB')
  await native.execute('INSERT INTO project_acceptances(id,no,name,project_id,contract_id,document_date,contract_estimate,status,unknown_text,unknown_integer,unknown_blob) VALUES(\'native-acceptance\',\'YS-ORIGINAL\',\'原验收\',\'native-project\',\'native-main\',\'2026-10-01\',NULL,\'draft\',?,9223372036854775807,X\'0080FF\')', ['{ "unknown": [7,"原记录"] }'])
  await native.execute('INSERT INTO owner_penalties(id,no,project_id,contract_id,amount,penalty_date,reason,status) VALUES(\'native-owner-penalty\',\'FK-ORIGINAL\',\'native-project\',\'native-main\',0,\'2026-10-01\',\'原真实零罚扣\',\'submitted\')')
  await native.execute('INSERT INTO subcontract_change_orders(id,no,project_id,supplier_id,contract_id,change_date,approved_amount,reason,status) VALUES(\'native-sub-change\',\'BQ-ORIGINAL\',\'native-project\',\'native-supplier\',\'native-sub\',\'2026-10-01\',0,\'原冻结变洽签\',\'approved\')')
  await native.execute('INSERT INTO expenditure_settlements(id,no,name,biz_type,project_id,supplier_id,contract_id,total_amount,settlement_date,status) VALUES(\'native-sub-settlement\',\'JS-ORIGINAL\',\'原分包结算\',\'分包\',\'native-project\',\'native-supplier\',\'native-sub\',200,\'2026-10-01\',\'confirmed\')')
  await native.execute('INSERT INTO penalty_records(id,no,projectId,supplier_id,contract_id,amount,penaltyDate,reason,status) VALUES(\'native-project-penalty\',\'XFK-ORIGINAL\',\'native-project\',\'native-supplier\',\'native-sub\',50,\'2026-10-01\',\'原独立罚扣\',\'pending\')')
  await native.execute('INSERT INTO penalty_settlement_deductions(id,penalty_id,settlement_id,amount,note) VALUES(\'native-deduction\',\'native-project-penalty\',\'native-sub-settlement\',20,\'原抵扣事实\')')
  if (auxiliary) {
    await native.execute('INSERT INTO contracts(id,name,no,kind,project_id,supplier_id,status) VALUES(?,\'原其他支出合同\',\'ORIGINAL-AUX\',\'其他支出\',\'native-project\',\'native-supplier\',\'已签订\')', [auxiliary.id])
    await native.execute('INSERT INTO expenditure_settlements(id,no,name,biz_type,project_id,supplier_id,contract_id,total_amount,settlement_date,status) VALUES(\'native-other-settlement\',\'OTHER-ORIGINAL\',\'原Other结算\',\'其他支出\',\'native-project\',\'native-supplier\',?,100,\'2026-10-01\',\'confirmed\')', [auxiliary.id])
    await native.execute('INSERT INTO penalty_records(id,no,projectId,supplier_id,contract_id,amount,penaltyDate,reason,status) VALUES(\'native-other-penalty\',\'OTHER-PENALTY\',\'native-project\',\'native-supplier\',?,20,\'2026-10-01\',\'原Other抵扣罚扣\',\'pending\')', [auxiliary.id])
    await native.execute('INSERT INTO penalty_settlement_deductions(id,penalty_id,settlement_id,amount,note) VALUES(\'native-other-deduction\',\'native-other-penalty\',\'native-other-settlement\',10,\'原独立Other抵扣\')')
  }
  await native.execute('INSERT INTO owner_penalties(id,no,project_id,contract_id,amount,reason,status,deleted_at) VALUES(\'native-deleted\',\'DELETE-ORIGINAL\',\'native-project\',\'native-main\',9,\'原软删历史\',\'draft\',\'2026-10-01 01:00:00\')')
  native.raw.exec('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES(\'native-blob\',\'project_acceptance\',\'native-acceptance\',\'原验收.bin\',\'\',4,\'application/octet-stream\',\'acceptance-report\',NULL,NULL); INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'native-blob\',\'base64\',\'AAqA/w==\'); INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES(\'native-missing\',\'project_acceptance\',\'native-acceptance\',\'原缺件.bin\',\'\',7,\'application/octet-stream\',\'acceptance-report\',NULL,NULL)')
  await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES(\'native-null-size\',\'project_acceptance\',\'native-acceptance\',\'原未知大小缺件.bin\',\'\',NULL,\'application/octet-stream\',\'acceptance-report\',NULL,NULL)')
  await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES(\'native-zero-size\',\'project_acceptance\',\'native-acceptance\',\'原实际空原件.bin\',\'\',0,\'application/octet-stream\',\'acceptance-report\',NULL,NULL)')
  await native.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(\'native-zero-size\',\'base64\',\'\')')
  await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(\'native-audit\',\'project_acceptances\',\'native-acceptance\',\'update\',?,NULL)', ['{ "originalAudit": "原精确JSON" }'])
  await native.execute('CREATE TABLE owner_document_command_receipts(workspace_id TEXT,actor_id TEXT,command_id TEXT,result_json TEXT,PRIMARY KEY(workspace_id,actor_id,command_id))')
  await native.execute('INSERT INTO owner_document_command_receipts VALUES(?,?,?,?)', [actor.workspaceId, actor.actorId, 'native-source-command', '{ "originalReceipt": true }'])
  native.raw.exec('CREATE TABLE unrelated_private(id TEXT PRIMARY KEY,secret TEXT); INSERT INTO unrelated_private VALUES(\'private\',\'NEVER_COPY_OTHER_PRIVATE_DOMAIN\')')
  const bytes = Buffer.from(native.raw.export())
  native.close()
  const path = resolve(f.options.directory, 'native-business-original.sqlite')
  await writeFile(path, bytes)
  const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
  if (auxiliary) {
    const importer = createProductionOtherSettlementMigration(f.storage)
    const preview = await importer.previewSnapshot(source, f.session)
    const actual = { projects: f.project.id, suppliers: f.supplier.id }
    const mappings = preview.references.map((reference) => {
      const candidate = preview.candidates.find(candidate => candidate.entityType === reference.entityType && candidate.serverId === actual[reference.entityType as keyof typeof actual])!
      return { entityType: reference.entityType, legacyId: reference.legacyId, targetId: candidate.serverId, version: candidate.version, sourceVersion: candidate.sourceVersion, reason: '原完整关系逐条核验' }
    })
    await importer.importSnapshot({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'business-other-ancestor-adopt', source, mappings }, f.session)
  }
  const migration = createProductionOwnerDocumentMigration(f.storage)
  const command: OwnerDocumentMigrationCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: 'business-original-adopt', source, selections: [], originals: [] }
  const preview = await migration.preflight(command, f.session)
  const actual = { 'project': f.project.id, 'customer': f.customer.id, 'supplier': f.supplier.id, 'construction': f.main.id, 'subcontract': sub.id, 'auxiliary': auxiliary?.id, 'other-settlement': 'native-other-settlement' }
  command.selections = preview.references.map((reference) => {
    const candidate = reference.candidates.find(candidate => candidate.id === actual[reference.kind as keyof typeof actual])!
    return { kind: reference.kind, legacyId: reference.legacyId, id: candidate.id, version: candidate.version }
  })
  return { ...f, actor, sub, path, bytes, source, preview, migration, command }
}

it('真实Native已申报adjusted与已审定exported月报，同SHA施工→BOQ→商务采用保冻结原量价，冷读与原审定动作可恢复', async () => {
  const f = await createSubcontractFixture()
  const actor = f.session()
  actor.capabilities.push('construction-contract:import', 'core:migration:write', 'boq:read', 'boq:write', 'boq:import', 'owner-document:import', 'owner-document:read', 'owner-document:write', 'subcontract-document:read')
  f.setActor(actor)
  const native = await createMigratedMemoryDb()
  try {
    await native.execute('INSERT INTO customers(id,name) VALUES(\'native-monthly-customer\',\'原甲方\')')
    await native.execute('INSERT INTO projects(id,name,customer_id) VALUES(\'native-monthly-project\',\'原项目\',\'native-monthly-customer\')')
    await native.execute('INSERT INTO contracts(id,no,name,kind,project_id,customer_id,amount,status,content,sign_date) VALUES(\'native-monthly-main\',\'MONTHLY-MAIN\',\'原施工主合同\',\'施工\',\'native-monthly-project\',\'native-monthly-customer\',1000,\'已签订\',\'原施工范围\',\'2026-09-01\')')
    await native.execute('INSERT INTO boq_files(id,contract_id,file_name,file_path,format_class,parse_status) VALUES(\'native-monthly-file\',\'native-monthly-main\',\'原登记清单.xlsx\',\'\',\'D\',\'parsed\')')
    await native.execute('INSERT INTO boq_lines(id,boq_file_id,project_id,contract_id,item_name,unit,qty,unit_price,recognized_qty,recognized_unit_price) VALUES(\'native-monthly-line\',\'native-monthly-file\',\'native-monthly-project\',\'native-monthly-main\',\'原报量分项\',\'㎡\',100,29,100,29)')
    for (const [id, status, period, reportedQty, auditedQty] of [['native-reported', 'adjusted', '2026-08', 4, null], ['native-audited', 'exported', '2026-09', 3, 2]] as const) {
      await native.execute('INSERT INTO monthly_statements(id,no,project_id,contract_id,month,period_no,application_date,status,total_amount,reported_amount,audited_amount,quantity_basis,source_version,operator_name,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)', [id, `${id}-NO`, 'native-monthly-project', 'native-monthly-main', period, period, `${period}-20`, status, reportedQty * 11, reportedQty * 11, auditedQty === null ? null : auditedQty * 11, 'field', `original-frozen-${id}`, ''])
      await native.execute('INSERT INTO monthly_statement_lines(id,statement_id,boq_line_id,item_name,unit,auto_qty,adjusted_qty,reported_qty,audited_qty,unit_price,amount,audited_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [`${id}-line`, id, 'native-monthly-line', '原冻结报量分项', '㎡', 6, reportedQty, reportedQty, auditedQty, 11, reportedQty * 11, auditedQty === null ? null : auditedQty * 11])
    }
    const bytes = Buffer.from(native.raw.export())
    const originalPath = resolve(f.options.directory, 'native-original-monthly.sqlite')
    await writeFile(originalPath, bytes)
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
    const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
    const construction = createProductionConstructionMigration(f.storage)
    const parent: ConstructionImportCommand = { ...identity, commandId: 'native-monthly-main-adopt', source, projects: [], customers: [], signatories: [], originals: [] }
    const parentPreview = await construction.preflight(parent, f.session)
    parent.projects = parentPreview.references.filter(row => row.kind === 'project').map(row => ({ legacyId: row.id, id: f.project.id, version: row.candidates.find(candidate => candidate.id === f.project.id)!.version }))
    parent.customers = parentPreview.references.filter(row => row.kind === 'customer').map(row => ({ legacyId: row.id, id: f.customer.id, version: row.candidates.find(candidate => candidate.id === f.customer.id)!.version }))
    await construction.adopt(parent, f.session)
    const boq = createProductionBoqMigration(f.storage)
    const clear: BoqSourceImportCommand = { ...identity, commandId: 'native-monthly-boq-adopt', source, heads: [], originals: [] }
    const boqPreview = await boq.preflight(clear, f.session)
    clear.heads = boqPreview.heads.map(head => ({ id: head.id, version: head.version }))
    await boq.adopt(clear, f.session)
    const migration = createProductionOwnerDocumentMigration(f.storage)
    const command: OwnerDocumentMigrationCommand = { ...identity, commandId: 'native-monthly-owner-adopt', source, selections: [], originals: [] }
    const preview = await migration.preflight(command, f.session)
    const actual = { project: f.project.id, customer: f.customer.id, construction: 'native-monthly-main' }
    command.selections = preview.references.map((row) => {
      const candidate = row.candidates.find(candidate => candidate.id === actual[row.kind as keyof typeof actual])!
      return { kind: row.kind, legacyId: row.legacyId, id: candidate.id, version: candidate.version }
    })
    await migration.adopt(command, f.session)
    const owner = createProductionOwnerDocumentService(f.storage)
    expect((await owner.form('owner_report', 'native-reported', f.session)).draft).toMatchObject({ status: 'reported', operatorName: '', submittedAt: null, reportedAmount: 44, lines: [expect.objectContaining({ reportedQty: 4, unitPrice: 11 })] })
    expect((await owner.form('owner_report', 'native-audited', f.session)).draft).toMatchObject({ status: 'audited', operatorName: '', submittedAt: null, auditedAmount: 22, lines: [expect.objectContaining({ reportedQty: 3, auditedQty: 2, unitPrice: 11 })] })
    const [imported] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM owner_document_imports')
    const evidence = JSON.parse(imported!.evidence_json)
    expect(evidence.rawDomain.monthly_statements.find((row: { legacyId: string }) => row.legacyId === 'native-reported').columns.status.exactValue).toBe('adjusted')
    expect(evidence.rawDomain.monthly_statements.find((row: { legacyId: string }) => row.legacyId === 'native-audited').columns.status.exactValue).toBe('exported')
    await f.storage.close()
    const coldPath = resolve(f.options.directory, 'native-monthly-cold.json')
    await runColdProcess('production-owner-document-cold', [f.options.directory, JSON.stringify(actor), '[]', coldPath])
    const cold = JSON.parse(await readFile(coldPath, 'utf8'))
    expect(cold.forms).toContainEqual(expect.objectContaining({ id: 'native-reported', draft: expect.objectContaining({ status: 'reported', reportedAmount: 44, submittedAt: null }) }))
    expect(cold.forms).toContainEqual(expect.objectContaining({ id: 'native-audited', draft: expect.objectContaining({ status: 'audited', auditedAmount: 22 }) }))
    const form = await owner.form('owner_report', 'native-reported', f.session)
    const audit = { ...identity, requiredCapability: 'owner-document:write', commandId: 'native-original-monthly-audit', kind: 'owner_report' as const, action: 'audit' as const, id: form.id, baseVersion: form.version, audit: { lines: [{ boqLineId: 'native-monthly-line', auditedQty: 5 }] } }
    const audited = await owner.execute(audit, f.session)
    expect(await owner.execute(audit, f.session)).toEqual(audited)
    expect((await owner.form('owner_report', form.id, f.session)).draft).toMatchObject({ status: 'audited', auditedAmount: 55, reportedAmount: 44, submittedAt: null, lines: [expect.objectContaining({ reportedQty: 4, auditedQty: 5, unitPrice: 11 })] })
    await expect(owner.execute({ ...audit, id: 'native-audited', commandId: 'no-repeat-historical-audit', baseVersion: '1' }, f.session)).rejects.toThrow('已申报')
    await f.storage.close()
    await runColdProcess('production-owner-document-cold', [f.options.directory, JSON.stringify(actor), JSON.stringify([{ kind: 'owner_report', commandId: audit.commandId }]), coldPath])
    const afterAudit = JSON.parse(await readFile(coldPath, 'utf8'))
    expect(afterAudit.resolutions).toEqual([{ outcome: 'applied', result: audited }])
    expect(afterAudit.forms).toContainEqual(expect.objectContaining({ id: form.id, draft: expect.objectContaining({ status: 'audited', reportedAmount: 44, auditedAmount: 55, submittedAt: null, lines: [expect.objectContaining({ reportedQty: 4, auditedQty: 5, unitPrice: 11 })] }) }))
    expect(await readFile(originalPath)).toEqual(bytes)
  }
  finally {
    native.close()
    await f.storage.close()
  }
}, 30000)

it('完整SQLite商务同原ID/编号保原JSON扩展、冻结、软删、原审计、原回执与共享原件，独立进程冷恢复', async () => {
  const f = await fixture()
  try {
    expect(f.preview.documents).toContainEqual(expect.objectContaining({ id: 'native-owner-penalty', amount: '0.00' }))
    expect(f.preview.documents).toContainEqual(expect.objectContaining({ id: 'native-acceptance', amount: null }))
    const saved = await f.migration.adopt(f.command, f.session)
    expect(await f.migration.adopt(f.command, f.session)).toEqual(saved)
    const owner = createProductionOwnerDocumentService(f.storage)
    const acceptance = await owner.form('acceptance', 'native-acceptance', f.session)
    expect(acceptance.draft.contractEstimate).toBeNull()
    expect(acceptance.attachments).toContainEqual(expect.objectContaining({ id: 'native-null-size', fileSize: null, uploadedAt: null }))
    expect(acceptance.attachments).toContainEqual(expect.objectContaining({ id: 'native-zero-size', fileSize: 0, uploadedAt: null }))
    expect((await owner.file({ kind: 'acceptance', id: 'native-acceptance', fileId: 'native-zero-size', origin: 'real' }, f.session)).bytes).toHaveLength(0)
    expect((await owner.form('sub_settlement', 'native-sub-settlement', f.session)).draft.totalAmount).toBe(200)
    expect((await owner.detail('project_penalty', 'native-project-penalty', { origin: 'real' }, f.session)).penaltyDeductions).toHaveLength(1)
    await expect(owner.form('owner_penalty', 'native-deleted', f.session)).rejects.toThrow('不存在')
    await expect(owner.form('owner_penalty', 'native-deleted', f.session, true)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const [row] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM owner_document_imports')
    const evidence = JSON.parse(row!.evidence_json)
    expect(evidence.rawDomain.project_acceptances[0].columns).toMatchObject({ unknown_text: { exactValue: '{ "unknown": [7,"原记录"] }' }, unknown_integer: { sqliteType: 'integer', exactValue: '9223372036854775807' }, unknown_blob: { sqliteType: 'blob', exactValue: '0080FF' } })
    expect(evidence.rawDomain.operation_logs[0].columns.after_data.exactValue).toBe('{ "originalAudit": "原精确JSON" }')
    expect(evidence.rawDomain.owner_document_command_receipts[0].columns.result_json.exactValue).toBe('{ "originalReceipt": true }')
    expect(evidence.metadataOnlyFileIds).toEqual(['native-missing', 'native-null-size'])
    expect(evidence.documents.find((document: { id: string }) => document.id === 'native-acceptance').files).toContainEqual(expect.objectContaining({ id: 'native-null-size', fileSize: null }))
    expect(evidence.rawDomain.file_refs.find((file: { legacyId: string }) => file.legacyId === 'native-null-size').columns.file_size).toMatchObject({ sqliteType: 'null', exactValue: null })
    expect(row!.evidence_json).not.toContain(f.source.payloadBase64)
    expect(row!.evidence_json).not.toContain('AAqA/w==')
    expect(row!.evidence_json).not.toContain('NEVER_COPY_OTHER_PRIVATE_DOMAIN')
    expect(await readFile(f.path)).toEqual(f.bytes)
    expect(await f.storage.select('SELECT command_id FROM owner_document_command_receipts')).toEqual([])
    const preservedKey = 'native-source-command'
    await expect(owner.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: preservedKey, requiredCapability: 'owner-document:write', kind: 'owner_change', action: 'save', id: null, baseVersion: null, draft: { projectId: f.project.id, contractId: f.main.id, lines: [] }, attachments: {} }, f.session)).rejects.toThrow('原Native商务编号')
    await expect(f.migration.restore({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: preservedKey, sourceSha256: f.source.sha256, importId: saved.importId }, f.session)).rejects.toThrow('原Native商务编号')
    await expect(f.migration.resolve({ ...ownerDocumentMigrationDescriptor({ ...f.command, sourceSha256: f.source.sha256 }), commandId: preservedKey }, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT command_id FROM owner_document_import_resolutions WHERE command_id=?', [preservedKey])).toEqual([])
    expect(await f.migration.resolve(ownerDocumentMigrationDescriptor({ ...f.command, sourceSha256: f.source.sha256 }), f.session)).toEqual({ outcome: 'applied', result: saved })
    await f.storage.close()
    const output = resolve(f.options.directory, 'cold-import.json')
    await runColdProcess('production-owner-document-import-cold', [f.options.directory, JSON.stringify(f.actor), JSON.stringify(ownerDocumentMigrationDescriptor({ ...f.command, sourceSha256: f.source.sha256 })), output])
    const cold = JSON.parse(await readFile(output, 'utf8'))
    expect(cold.resolution).toEqual({ outcome: 'applied', result: saved })
    expect(cold.original).toEqual({ sha256: createHash('sha256').update(Buffer.from([0, 10, 128, 255])).digest('hex'), payloadBase64: 'AAqA/w==' })
    expect(cold.state.sources).toContainEqual(expect.objectContaining({ importId: saved.importId, restored: false }))
  }
  finally { await f.storage.close() }
}, 25000)

it('项目罚扣Other合同/结算祖先显式版本复用，同来源原抵扣保唯一头，不能恢复脱落外域事实', async () => {
  const f = await fixture(true)
  try {
    const before = await f.storage.select('SELECT * FROM expenditure_settlements WHERE id=\'native-other-settlement\'')
    const adopted = await f.migration.adopt(f.command, f.session)
    const detail = await createProductionOwnerDocumentService(f.storage).detail('project_penalty', 'native-other-penalty', { origin: 'real' }, f.session)
    expect(detail.penaltyDeductions).toHaveLength(1)
    expect(detail.penaltyDeductions[0]?.settlementId).toBe('native-other-settlement')
    expect(await f.storage.select('SELECT * FROM expenditure_settlements WHERE id=\'native-other-settlement\'')).toEqual(before)
    const [original] = await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM owner_document_imports')
    expect(JSON.parse(original!.evidence_json).rawDomain.expenditure_settlements).toContainEqual(expect.objectContaining({ legacyId: 'native-other-settlement' }))
    await expect(f.migration.restore({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'business-other-danger-restore', sourceSha256: f.source.sha256, importId: adopted.importId }, f.session)).rejects.toThrow('本批之外')
    expect(await f.storage.select('SELECT * FROM expenditure_settlements WHERE id=\'native-other-settlement\'')).toEqual(before)
  }
  finally { await f.storage.close() }
}, 25000)

it('错误完整字节、实际映射版本、原同key、结果未知及危险整批恢复原子保护', async () => {
  const f = await fixture()
  try {
    await expect(f.migration.preflight({ ...f.command, source: { ...f.source, sha256: 'a'.repeat(64) } }, f.session)).rejects.toThrow('摘要')
    await expect(f.migration.adopt({ ...f.command, commandId: 'native-source-command' }, f.session)).rejects.toThrow('历史商务命令')
    const stale = { ...f.command, commandId: 'business-stale-original', selections: f.command.selections.map(row => ({ ...row, version: 'outdated' })) }
    await expect(f.migration.adopt(stale, f.session)).rejects.toThrow('资格已变化')
    expect(await f.storage.select('SELECT id FROM monthly_statements')).toEqual([])
    expect(await f.migration.resolve(ownerDocumentMigrationDescriptor({ ...stale, sourceSha256: f.source.sha256 }), f.session)).toEqual({ outcome: 'not-applied', commandId: stale.commandId })
    await expect(f.migration.adopt(stale, f.session)).rejects.toThrow('封存')
    let lose = true
    const transport = createProductionOwnerDocumentMigration({ ...f.storage, async withTransaction(work) {
      const result = await f.storage.withTransaction(work)
      if (lose && result && typeof result === 'object' && 'importId' in result) {
        lose = false
        throw new Error('实际已采用但返回丢失')
      }
      return result
    } })
    await expect(transport.adopt(f.command, f.session)).rejects.toThrow('返回丢失')
    const original = await f.migration.resolve(ownerDocumentMigrationDescriptor({ ...f.command, sourceSha256: f.source.sha256 }), f.session)
    expect(original.outcome).toBe('applied')
    if (original.outcome !== 'applied')
      throw new Error('missing receipt')
    await expect(f.migration.adopt({ ...f.command, originals: [{ fileId: 'unknown', file: { fileName: 'other.bin', fileSize: 1, payloadBase64: 'YQ==' } }] }, f.session)).rejects.toThrow('已固定')
    const owner = createProductionOwnerDocumentService(f.storage)
    const form = await owner.form('acceptance', 'native-acceptance', f.session)
    const context = await owner.context('acceptance', f.session)
    const relationshipVersionsJson = JSON.stringify(Object.fromEntries([['projectId', context.projects, f.project.id], ['contractId', context.contracts, f.main.id]].map(([key, list, id]) => [key, { id, version: (list as typeof context.projects).find(row => row.id === id)!.version }])))
    await owner.execute({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'business-later-edit', requiredCapability: 'owner-document:write', kind: 'acceptance', action: 'save', id: form.id, baseVersion: form.version, draft: { ...form.draft, name: '后来合法修订', relationshipVersionsJson }, attachments: {} }, f.session)
    const before = await f.storage.select('SELECT * FROM project_acceptances')
    const restore = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'business-danger-restore', sourceSha256: f.source.sha256, importId: original.result.importId }
    await expect(f.migration.restore(restore, f.session)).rejects.toThrow('危险恢复拒绝')
    expect(await f.storage.select('SELECT * FROM project_acceptances')).toEqual(before)
    expect(await f.storage.select('SELECT * FROM owner_document_import_restores')).toEqual([])
    expect(await f.migration.resolve(ownerDocumentMigrationDescriptor(restore), f.session)).toEqual({ outcome: 'not-applied', commandId: restore.commandId })
    await expect(f.migration.restore(restore, f.session)).rejects.toThrow('封存')
  }
  finally { await f.storage.close() }
}, 25000)

it('未被后来事实消费的商务采用整批恢复仍保原SQLite证据、字节、审计与原回执', async () => {
  const f = await fixture()
  try {
    const adopted = await f.migration.adopt(f.command, f.session)
    const command = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'business-safe-restore', sourceSha256: f.source.sha256, importId: adopted.importId }
    const restored = await f.migration.restore(command, f.session)
    expect(await f.migration.restore(command, f.session)).toEqual(restored)
    expect(await f.migration.resolve(ownerDocumentMigrationDescriptor(command), f.session)).toEqual({ outcome: 'applied', result: restored })
    expect((await f.migration.state(f.session)).sources[0]?.restored).toBe(true)
    expect(await f.storage.select('SELECT id FROM owner_document_imports')).toHaveLength(1)
    expect(await f.storage.select('SELECT file_ref_id FROM file_payloads WHERE file_ref_id=\'native-blob\'')).toHaveLength(1)
    expect(await f.storage.select('SELECT id FROM penalty_settlement_deductions')).toHaveLength(1)
    await f.storage.close()
    const reopened = createProductionStorage(f.options)
    try {
      const owner = createProductionOwnerDocumentService(reopened)
      expect((await owner.list('sub_settlement', { origin: 'real' }, f.session)).items).toEqual([])
      expect(await createProductionOwnerDocumentMigration(reopened).resolve(ownerDocumentMigrationDescriptor(command), f.session)).toEqual({ outcome: 'applied', result: restored })
    }
    finally { await reopened.close() }
  }
  finally { await f.storage.close() }
}, 25000)
