import type { SubcontractImportCommand } from '../../app/lib/subcontract-contract/import-contract'
import type { createSubcontractFixture } from './production-subcontract-fixture'
import { Buffer } from 'node:buffer'
import { runMigrations } from '../../app/lib/db/migrations'
import { contractOriginalDigest } from '../../server/utils/contract-original'
import { createProductionSubcontractMigration } from '../../server/utils/production-subcontract-contract-migration'
import { createMemoryDb } from './memory-db'

export async function createSubcontractNative(f: Pick<Awaited<ReturnType<typeof createSubcontractFixture>>, 'storage' | 'session' | 'project' | 'supplier'>, legacyCommand = false, amounts: { head?: number | null, supplement?: number | null, status?: string, uploadedAt?: string | null } = {}) {
  const native = await createMemoryDb()
  await runMigrations(native)
  await native.execute('INSERT INTO projects(id,name) VALUES(\'legacy-sub-project\',\'原分包工程\')')
  await native.execute('INSERT INTO suppliers(id,name) VALUES(\'legacy-sub-supplier\',\'原分包商\')')
  await native.execute('ALTER TABLE contracts ADD COLUMN extension_json TEXT')
  await native.execute('ALTER TABLE contracts ADD COLUMN extension_integer INTEGER')
  await native.execute('ALTER TABLE contracts ADD COLUMN extension_blob BLOB')
  await native.execute('ALTER TABLE contract_supplements ADD COLUMN extension_json TEXT')
  await native.execute('INSERT INTO contracts(id,no,name,kind,sub_kind,project_id,supplier_id,amount,tax_rate,status,content,sign_date,extension_json) VALUES (\'legacy-sub-head\',\'LEGACY-SUB\',\'原劳务分包\',\'分包\',\'劳务\',\'legacy-sub-project\',\'legacy-sub-supplier\',NULL,0,\'已签订\',\'原完整劳务约定\',\'2026-09-01\',?)', ['{"unknown":"原分包扩展","legacy":"legacy-sub-project"}'])
  await native.execute('UPDATE contracts SET extension_integer=CAST(\'9223372036854775807\' AS INTEGER),extension_blob=x\'0080FF\' WHERE id=\'legacy-sub-head\'')
  await native.execute('INSERT INTO contract_supplements(id,contract_id,no,name,amount,status,sign_date,extension_json) VALUES (\'legacy-sub-supp\',\'legacy-sub-head\',\'LEGACY-SUB-SUPP\',\'原补充劳务约定\',0,\'有效\',\'2026-09-02\',?)', ['{"original":"不得改变原JSON"}'])
  if (amounts.head !== undefined)
    await native.execute('UPDATE contracts SET amount=? WHERE id=\'legacy-sub-head\'', [amounts.head])
  if (amounts.supplement !== undefined)
    await native.execute('UPDATE contract_supplements SET amount=? WHERE id=\'legacy-sub-supp\'', [amounts.supplement])
  if (amounts.status)
    await native.execute('UPDATE contract_supplements SET status=? WHERE id=\'legacy-sub-supp\'', [amounts.status])
  await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'legacy-sub-head-file\',\'contract\',\'legacy-sub-head\',\'原分包签约.txt\',\'\',3,\'text/plain\'),(\'legacy-sub-supp-file\',\'contract_supplement\',\'legacy-sub-supp\',\'原协议.bin\',\'D:/旧分包/协议.bin\',4,\'application/octet-stream\')')
  await native.execute('INSERT INTO file_payloads VALUES (\'legacy-sub-head-file\',\'base64\',\'YWJj\')')
  if (Object.hasOwn(amounts, 'uploadedAt'))
    await native.execute('UPDATE file_refs SET uploaded_at=?', [amounts.uploadedAt ?? null])
  await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'legacy-sub-audit\',\'contracts\',\'legacy-sub-head\',\'update\',?)', ['{"original":"原审计JSON"}'])
  if (legacyCommand) {
    await native.execute('CREATE TABLE subcontract_contract_receipts(command_id TEXT PRIMARY KEY,contract_id TEXT,actor_id TEXT,result_json TEXT)')
    await native.execute('INSERT INTO subcontract_contract_receipts VALUES (?,?,?,?)', ['legacy-sub-command', 'legacy-sub-head', 'legacy-unmapped-actor', '{"commandId":"legacy-sub-command","id":"legacy-sub-head","extension":"原回执"}'])
  }
  await native.execute('CREATE TABLE private_other_domain(secret TEXT)')
  await native.execute('INSERT INTO private_other_domain VALUES (\'DONT_COPY_SUBCONTRACT_OTHER_PRIVATE_DOMAIN\')')
  const bytes = native.raw.export()
  native.close()
  const service = createProductionSubcontractMigration(f.storage)
  const command: SubcontractImportCommand = { commandId: 'sub-native-adopt', workspaceId: f.session().workspaceId, actorId: f.session().actorId, source: { sha256: contractOriginalDigest(bytes), payloadBase64: Buffer.from(bytes).toString('base64') }, projects: [], suppliers: [], signatories: [], originals: [{ fileId: 'legacy-sub-supp-file', payloadBase64: 'AAECAw==' }] }
  const preview = await service.preflight(command, f.session)
  command.projects = preview.references.filter(row => row.kind === 'project').map(row => ({ legacyId: row.id, id: f.project.id, version: row.candidates.find(candidate => candidate.id === f.project.id)!.version }))
  command.suppliers = preview.references.filter(row => row.kind === 'supplier').map(row => ({ legacyId: row.id, id: f.supplier.id, version: row.candidates.find(candidate => candidate.id === f.supplier.id)!.version }))
  return { service, command, bytes }
}
