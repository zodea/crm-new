import type { StoredMaterialContract } from '../../server/utils/material-contract-command-test-instance'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { validateMaterialContractIdentities } from '../../server/utils/contract-identity-evidence'
import { PRODUCTION_CONSTRUCTION_SCOPE_TABLES } from '../../server/utils/production-construction-scope-schema'
import { createProductionStorage } from '../../server/utils/production-storage'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES, productionStorageManifest } from '../../server/utils/production-storage-schema'

// Independent expected release scope: checking only the version would miss a partial owner registration.
const expectedParticipants = ['auxiliary-contract', 'backup', 'boq', 'construction-contracts', 'construction-scope', 'contract-number-registry', 'crew-worker', 'customer', 'finance', 'material-contracts', 'material-quotations', 'notifications', 'other-settlements', 'our-signatories', 'payroll', 'process-library', 'project', 'quantity', 'subcontract-contracts', 'supplier', 'target-cost', 'wbs']
const appendedOpt02Participants = ['target-cost', 'quantity', 'payroll', 'wbs', 'construction-contracts', 'boq', 'construction-scope', 'subcontract-contracts', 'auxiliary-contract'].map(domain => ({ domain, schema_version: domain === 'construction-scope' ? 2 : 1 }))

it('真实v26工程关联扩展保全已有绑定、解绑和两种来源全部原证据，冷开不改写且不可变保护继续生效', async () => {
  const base = resolve('.tmp/opt02-scope-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/populated-v26-`)
  const raw = new DatabaseSync(join(directory, 'ruihang.sqlite'))
  raw.exec('PRAGMA foreign_keys=ON; BEGIN')
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 26)) raw.exec(upgrade.sql)
  const timestamp = '2026-10-07T00:00:00.000Z'
  raw.prepare('INSERT INTO production_metadata VALUES(1,26,?,?,?,?)').run('scope-upgrade-workspace', 'scope-upgrade-owner', 'verification', timestamp)
  raw.prepare('INSERT INTO projects(id,name,code,customer_id,secondary_customer_id,draft_json,version,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('original-project', '旧工程', 'OLD-P', null, null, '{ "extension" : "原文\\t保留" }', 1, timestamp, timestamp, null)
  raw.prepare('INSERT INTO construction_contract_records(id,project_id,customer_id,deleted_at,record_json) VALUES(?,?,?,?,?)').run('original-main', 'original-project', null, null, '{ "draft" : { "id":"original-main","no":"OLD-M","name":"旧主合同" }, "version":1 }')
  const digest = 'a'.repeat(64)
  const original = ' { "unknown" : [0,null,"原文\\n保留"], "large" : "9223372036854775807" } '
  for (const [domain, link, source, deleted] of [['material-contract', 'old-material-link', 'old-material', timestamp], ['original-expense', 'old-expense-link', 'old-expense-line', null]] as const) {
    raw.prepare('INSERT INTO construction_scope_links VALUES(?,?,?,?,?,?,?,?,?,?)').run(link, domain, source, 'original-project', deleted ? null : 'original-main', deleted ? 2 : 1, digest, deleted ? null : digest, timestamp, deleted)
    const versions = deleted ? [1, 2] : [1]
    for (const version of versions) {
      const commandId = `${link}-v${version}`
      const unbound = deleted && version === 2
      raw.prepare('INSERT INTO construction_scope_intents VALUES(?,?,?,?,?,?,?,?)').run(commandId, 'scope-upgrade-workspace', 'scope-upgrade-owner', link, unbound ? 'unbind' : 'bind', digest, original, timestamp)
      raw.prepare('INSERT INTO construction_scope_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(link, version, domain, source, 'original-project', unbound ? null : 'original-main', digest, unbound ? null : digest, commandId, 'scope-upgrade-owner', timestamp, unbound ? timestamp : null)
      raw.prepare('INSERT INTO construction_scope_receipts VALUES(?,?,?,?,?,?,?)').run(commandId, 'scope-upgrade-workspace', 'scope-upgrade-owner', link, digest, original, timestamp)
    }
  }
  raw.prepare('INSERT INTO construction_scope_resolutions VALUES(?,?,?,?,?,?)').run('original-unknown-command', 'scope-upgrade-workspace', 'scope-upgrade-owner', 'old-material-link', 'bind', timestamp)
  raw.exec('UPDATE construction_scope_revision SET revision=3; COMMIT')
  const before = PRODUCTION_CONSTRUCTION_SCOPE_TABLES.map(table => raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  raw.close()
  const storage = createProductionStorage({ directory, workspaceId: 'scope-upgrade-workspace', ownerId: 'scope-upgrade-owner', purpose: 'verification' })
  try {
    expect((await storage.status()).schemaVersion).toBe(28)
    expect(await Promise.all(PRODUCTION_CONSTRUCTION_SCOPE_TABLES.map(table => storage.select(`SELECT * FROM ${table} ORDER BY rowid`)))).toEqual(before)
    expect(await storage.select('PRAGMA foreign_key_check')).toEqual([])
    await storage.close()
    expect(await Promise.all(PRODUCTION_CONSTRUCTION_SCOPE_TABLES.map(table => storage.select(`SELECT * FROM ${table} ORDER BY rowid`)))).toEqual(before)
    for (const table of ['construction_scope_history', 'construction_scope_intents', 'construction_scope_receipts', 'construction_scope_resolutions']) {
      await expect(storage.execute(`DELETE FROM ${table}`)).rejects.toThrow('immutable')
      await expect(storage.execute(`UPDATE ${table} SET actor_id=actor_id`)).rejects.toThrow('immutable')
    }
    await expect(storage.execute('DELETE FROM construction_scope_links')).rejects.toThrow('cannot be deleted')
  }
  finally { await storage.close() }
})
function participantsAfterOpt02(originals: Record<string, unknown>[]) {
  return [...originals, ...appendedOpt02Participants].sort((left, right) => String(left.domain).localeCompare(String(right.domain)))
}
const newOwnerTables = [
  'auxiliary_contract_revision',
  'auxiliary_contract_records',
  'auxiliary_contract_supplements',
  'auxiliary_contract_versions',
  'auxiliary_contract_files',
  'auxiliary_contract_intents',
  'auxiliary_contract_receipts',
  'auxiliary_contract_resolutions',
  'auxiliary_contract_imports',
  'auxiliary_contract_import_restores',
  'quotation_revision',
  'material_quotations',
  'material_quotation_lines',
  'material_quotation_history',
  'material_quotation_commands',
  'material_quotation_resolutions',
  'material_quotation_files',
  'quotation_imports',
  'current_transactions',
  'expense_reimbursements',
  'expense_reimbursement_lines',
  'invoice_applications',
  'payment_applications',
  'payment_records',
  'payment_application_settlement_allocations',
  'payment_application_invoice_allocations',
  'payment_record_application_allocations',
  'operation_logs',
  'finance_versions',
  'finance_history',
  'finance_revision',
  'finance_commands',
  'finance_resolutions',
  'finance_imports',
  'finance_import_resolutions',
  'finance_payment_verifications',
  'finance_expense_clearance_verifications',
  'crew_worker_revision',
  'crews',
  'workers',
  'crew_worker_audits',
  'crew_worker_command_receipts',
  'crew_worker_command_resolutions',
  'crew_worker_import_sources',
  'crew_worker_import_receipts',
  'crew_worker_import_resolutions',
  'worker_roster_profile_versions',
  'worker_roster_assets',
  'worker_roster_archives',
  'worker_roster_receipts',
  'expenditure_settlements',
  'expenditure_settlement_expense_allocations',
  'other_settlement_revision',
  'other_settlement_history',
  'other_settlement_commands',
  'other_settlement_resolutions',
  'other_settlement_files',
  'other_settlement_imports',
  'expenditure_settlement_clearance_links',
  'target_costs',
  'target_cost_items',
  'target_cost_versions',
  'target_cost_commands',
  'target_cost_resolutions',
  'target_cost_draft_claims',
  'target_cost_files',
  'target_cost_imports',
  'target_cost_import_restores',
  'target_cost_import_commands',
  'target_cost_import_resolutions',
  'items',
  'buildings',
  'floors',
  'units',
  'house_type_templates',
  'rooms',
  'house_type_template_items',
  'construction_stages',
  'construction_stage_items',
  'unit_assignments',
  'unit_assignment_scopes',
  'unit_stage_completions',
  'quantity_boq_references',
  'quantity_hollow_records',
  'quantity_hollow_revisions',
  'quantity_hollow_rectifications',
  'quantity_hollow_logs',
  'quantity_hollow_command_receipts',
  'quantity_hollow_migration_evidence',
  'quantity_revisions',
  'quantity_commands',
  'quantity_resolutions',
  'quantity_command_intents',
  'quantity_source_imports',
  'quantity_import_restores',
  'payroll_subject_configs',
  'wage_statements',
  'wage_statement_lines',
  'wage_statement_members',
  'attendance_records',
  'signed_daywork_records',
  'wage_statement_daywork_records',
  'wage_statement_allocations',
  'payroll_revision',
  'payroll_migration_evidence',
  'payroll_a_subject_configs',
  'payroll_a_price_revisions',
  'payroll_a_statement_sources',
  'payroll_command_receipts',
  'payroll_c1_rate_revisions',
  'payroll_c1_statement_sources',
  'payroll_c2_statement_sources',
  'payroll_adjustments',
  'payroll_actual_events',
  'payroll_actual_allocations',
  'payroll_adjustment_applications',
  'payroll_a_adjustment_coverage',
  'payroll_a_management_books',
  'payroll_a_management_book_revisions',
  'payroll_a_fee_revisions',
  'payroll_a_statement_books',
  'payroll_a_negative_lines',
  'payroll_a_management_ownership',
  'payroll_a_rounding_revisions',
  'payroll_hollow_policy_revisions',
  'payroll_hollow_starts',
  'payroll_hollow_adoptions',
  'payroll_batch_plans',
  'payroll_batch_attempts',
  'payroll_batch_command_receipts',
  'payroll_numbering_settings',
  'payroll_official_issues',
  'payroll_workbook_archives',
  'payroll_workbook_receipts',
  'payroll_workbook_references',
  'payroll_publication_migration_proofs',
  'payroll_command_journal',
  'payroll_command_intents',
  'payroll_source_imports',
  'quantity_contract_references',
  'schedule_group_buildings',
  'task_dependencies',
  'schedule_groups',
  'schedule_tasks',
  'task_item_map',
  'schedule_task_floor_plans',
  'schedule_migration_evidence',
  'schedule_command_receipts',
  'schedule_revisions',
  'schedule_floor_quantity_snapshots',
  'schedule_command_intents',
  'schedule_command_resolutions',
  'schedule_source_imports',
  'schedule_import_restores',
  'schedule_files',
  'schedule_import_intents',
  'schedule_import_commands',
  'schedule_import_resolutions',
  'construction_contract_revision',
  'construction_contract_records',
  'construction_contract_supplements',
  'construction_contract_versions',
  'construction_contract_files',
  'construction_contract_intents',
  'construction_contract_receipts',
  'construction_contract_resolutions',
  'construction_contract_imports',
  'construction_contract_import_restores',
  'construction_contract_import_intents',
  'construction_contract_import_receipts',
  'construction_contract_import_resolutions',
  'construction_scope_revision',
  'construction_scope_links',
  'construction_scope_history',
  'construction_scope_intents',
  'construction_scope_receipts',
  'construction_scope_resolutions',
  'boq_revision',
  'boq_files',
  'boq_lines',
  'item_unit_prices',
  'boq_change_records',
  'boq_history',
  'boq_command_intents',
  'boq_commands',
  'boq_resolutions',
  'boq_source_imports',
  'boq_import_restores',
  'boq_source_bindings',
  'boq_import_intents',
  'boq_import_commands',
  'boq_import_resolutions',
  'subcontract_contract_revision',
  'subcontract_contract_records',
  'subcontract_contract_supplements',
  'subcontract_contract_versions',
  'subcontract_contract_files',
  'subcontract_contract_intents',
  'subcontract_contract_receipts',
  'subcontract_contract_resolutions',
  'subcontract_contract_imports',
  'subcontract_contract_import_restores',
  'subcontract_contract_import_intents',
  'subcontract_contract_import_receipts',
  'subcontract_contract_import_resolutions',
]
async function assertCurrentOwnerStructure(storage: ReturnType<typeof createProductionStorage>) {
  expect((await storage.status()).schemaVersion).toBe(28)
  expect((await storage.status()).participants.slice().sort()).toEqual(expectedParticipants)
  expect(await storage.select('SELECT * FROM production_participants ORDER BY domain')).toEqual(expectedParticipants.map(domain => ({ domain, schema_version: domain === 'construction-scope' ? 2 : 1 })))
  for (const table of newOwnerTables) {
    expect(await storage.select(`SELECT * FROM ${table}`)).toEqual(table.endsWith('_revision') ? [{ singleton: 1, revision: 0 }] : [])
  }
  const references = [
    ['material_quotation_lines', 'quotation_id', 'material_quotations'],
    ['payment_record_application_allocations', 'payment_record_id', 'payment_records'],
    ['crew_worker_import_receipts', 'source_sha256', 'crew_worker_import_sources'],
    ['expenditure_settlement_expense_allocations', 'settlement_id', 'expenditure_settlements'],
    ['finance_payment_verifications', 'application_id', 'payment_applications'],
    ['finance_payment_verifications', 'command_id', 'finance_commands'],
    ['finance_expense_clearance_verifications', 'original_expense_line_id', 'expense_reimbursement_lines'],
    ['finance_expense_clearance_verifications', 'reimbursement_id', 'expense_reimbursements'],
    ['finance_expense_clearance_verifications', 'command_id', 'finance_commands'],
    ['expenditure_settlement_clearance_links', 'expense_allocation_id', 'expenditure_settlement_expense_allocations'],
    ['expenditure_settlement_clearance_links', 'verification_id', 'finance_expense_clearance_verifications'],
  ]
  for (const [table, from, target] of references)
    expect(await storage.select(`PRAGMA foreign_key_list(${table})`)).toEqual(expect.arrayContaining([expect.objectContaining({ from, table: target })]))
  for (const [index, columns] of [['material_quotation_line_owner', ['quotation_id']], ['finance_payment_bank_serial', ['bank_serial_no']], ['other_settlement_expense_unique', ['settlement_id', 'original_expense_line_id']]] as const)
    expect((await storage.select<{ name: string }>(`PRAGMA index_info(${index})`)).map(row => row.name)).toEqual(columns)
  for (const [table, keys] of [['material_quotation_history', ['quotation_id', 'version']], ['finance_history', ['kind', 'id', 'version']], ['crew_worker_command_receipts', ['workspace_id', 'actor_id', 'kind', 'command_id']], ['other_settlement_history', ['settlement_id', 'version']]] as const)
    expect((await storage.select<{ name: string, pk: number }>(`PRAGMA table_info(${table})`)).filter(row => row.pk > 0).sort((left, right) => left.pk - right.pk).map(row => row.name)).toEqual(keys)
  const guards = ['quotation_history_update', 'quotation_history_delete', 'finance_history_no_update', 'finance_history_no_delete', 'finance_payment_verifications_no_update', 'finance_payment_verifications_no_delete', 'finance_expense_clearance_verifications_no_update', 'finance_expense_clearance_verifications_no_delete', 'expenditure_settlement_clearance_links_no_update', 'expenditure_settlement_clearance_links_no_delete', 'crew_worker_audits_immutable_update', 'crew_worker_audits_immutable_delete', 'worker_roster_archives_immutable_update', 'worker_roster_archives_immutable_delete', 'other_settlement_history_update', 'other_settlement_history_delete', 'other_settlement_confirmed_expense_insert']
  expect((await storage.select<{ name: string }>(`SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN (${guards.map(() => '?').join(',')}) ORDER BY name`, guards)).map(row => row.name)).toEqual(guards.slice().sort())
  expect(await storage.select('PRAGMA foreign_key_check')).toEqual([])
}

async function assertFrozenHistoryGuards(storage: ReturnType<typeof createProductionStorage>) {
  const rollbackProbe = new Error('rollback-independent-schema-probes')
  await expect(storage.withTransaction(async (tx) => {
    await tx.execute('INSERT INTO material_quotations VALUES(?,?,?,?,?,?,?,?,?,?)', ['quotation-probe', '合成结构验证', null, null, 'general', null, '{}', 1, '2026-10-01', '2026-10-01'])
    await tx.execute('INSERT INTO material_quotation_history VALUES(?,?,?,?,?,?)', ['quotation-probe', 1, '{"original":"保留Aa原文"}', 'historical-actor', 'probe-quote-command', '2026-10-01'])
    await tx.execute('INSERT INTO finance_history VALUES(?,?,?,?,?,?,?)', ['current', 'finance-probe', 1, 'probe-finance-command', 'historical-actor', '2026-10-01', '{"original":"保留Aa原文"}'])
    await tx.execute('INSERT INTO crew_worker_audits VALUES(?,?,?,?,?,?,?,?)', ['crew-worker-probe', 'worker', 'worker-probe', 'historical-actor', 'probe-worker-command', null, '{"original":"保留Aa原文"}', '2026-10-01'])
    await tx.execute('INSERT INTO expenditure_settlements(id) VALUES(?)', ['other-probe'])
    await tx.execute('INSERT INTO other_settlement_history VALUES(?,?,?,?,?,?)', ['other-probe', 1, '{"original":"保留Aa原文"}', 'historical-actor', 'probe-other-command', '2026-10-01'])
    for (const [table, column] of [['material_quotation_history', 'snapshot_json'], ['finance_history', 'snapshot_json'], ['crew_worker_audits', 'after_json'], ['other_settlement_history', 'snapshot_json']]) {
      await expect(tx.execute(`UPDATE ${table} SET ${column}='{}'`)).rejects.toThrow(/immutable|Frozen/)
      await expect(tx.execute(`DELETE FROM ${table}`)).rejects.toThrow(/immutable|Frozen/)
    }
    throw rollbackProbe
  })).rejects.toBe(rollbackProbe)
}

async function seedV7NumberGraph() {
  const base = resolve('.tmp/a03-storage-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/upgrade-from-v7-`)
  const path = join(directory, 'ruihang.sqlite')
  const raw = new DatabaseSync(path)
  raw.exec('BEGIN')
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 7)) raw.exec(upgrade.sql)
  raw.prepare('INSERT INTO production_metadata VALUES(1,7,?,?,?,?)').run('registry-workspace', 'registry-owner', 'verification', '2026-10-01T00:00:00.000Z')
  const firstTime = '2026-10-01T00:00:00.000Z'
  const secondTime = '2026-10-02T00:00:00.000Z'
  const history = { draft: { id: 'old-main', name: '真实旧合同', no: 'OLD-SAME', amount: 0, status: '履约中' }, attachments: [], version: 1, updatedAt: firstTime }
  const records: StoredMaterialContract[] = [
    { id: 'old-main', draft: { ...history.draft, no: 'PENDING-EDIT', amount: null, status: '草稿' }, attachments: [], version: 2, createdAt: firstTime, updatedAt: secondTime, history: [history] },
    { id: 'old-duplicate', draft: { id: 'old-duplicate', name: '历史同号事实', no: 'OLD-SAME', amount: null, status: '已作废' }, attachments: [], version: 1, createdAt: firstTime, updatedAt: firstTime, history: [] },
  ]
  for (const record of records) raw.prepare('INSERT INTO material_contract_records VALUES(?,NULL,NULL,NULL,?)').run(record.id, JSON.stringify(record))
  raw.exec('COMMIT')
  const options = { directory, workspaceId: 'registry-workspace', ownerId: 'registry-owner', purpose: 'verification' as const }
  return { raw, options, path, records }
}

it('真实v7升级中途冲突保旧版本、全部旧记录，不留下半张目录', async () => {
  const { raw, options, path, records } = await seedV7NumberGraph()
  raw.exec('CREATE TABLE contract_number_history(incompatible TEXT)')
  raw.close()
  await expect(createProductionStorage(options).status()).rejects.toThrow('无法初始化')
  const failed = new DatabaseSync(path)
  try {
    expect(failed.prepare('SELECT schema_version FROM production_metadata').get()?.schema_version).toBe(7)
    expect(failed.prepare('SELECT name FROM sqlite_master WHERE name=\'our_signatories\'').all()).toEqual([])
    expect(failed.prepare('SELECT record_json FROM material_contract_records ORDER BY id').all().map(row => JSON.parse(String(row.record_json)))).toEqual([records[1], records[0]])
  }
  finally {
    failed.exec('DROP TABLE contract_number_history')
    failed.close()
  }
  const retry = createProductionStorage(options)
  try {
    await assertCurrentOwnerStructure(retry)
    expect((await retry.select<{ record_json: string }>('SELECT record_json FROM material_contract_records ORDER BY id')).map(row => JSON.parse(row.record_json))).toEqual([records[1], records[0]])
  }
  finally { await retry.close() }
})

it('最后Other升级冲突也回滚此前全部新owner，保v7旧图；修复后同源可完整升级', async () => {
  const { raw, options, path, records } = await seedV7NumberGraph()
  raw.exec('CREATE TABLE other_settlement_files(old_evidence TEXT NOT NULL)')
  raw.exec('INSERT INTO other_settlement_files VALUES(\'真实独有旧证据\')')
  const sourceSchema = raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()
  raw.close()
  await expect(createProductionStorage(options).status()).rejects.toThrow('无法初始化')
  const failed = new DatabaseSync(path)
  try {
    expect(failed.prepare('SELECT schema_version FROM production_metadata').get()?.schema_version).toBe(7)
    expect(failed.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(sourceSchema)
    expect(failed.prepare('SELECT * FROM other_settlement_files').all()).toEqual([{ old_evidence: '真实独有旧证据' }])
    expect(failed.prepare('SELECT record_json FROM material_contract_records ORDER BY id').all().map(row => JSON.parse(String(row.record_json)))).toEqual([records[1], records[0]])
    failed.exec('DROP TABLE other_settlement_files')
  }
  finally { failed.close() }
  const retry = createProductionStorage(options)
  try {
    await assertCurrentOwnerStructure(retry)
    expect((await retry.select<{ record_json: string }>('SELECT record_json FROM material_contract_records ORDER BY id')).map(row => JSON.parse(row.record_json))).toEqual([records[1], records[0]])
  }
  finally { await retry.close() }
})

it('真实v7完整旧图升级占用最近成立编号，草稿改号/历史重复/未知金额保全且冷重开不重复', async () => {
  const { raw, options, records } = await seedV7NumberGraph()
  raw.close()
  const storage = createProductionStorage(options)
  try {
    await assertCurrentOwnerStructure(storage)
    expect(await storage.select('SELECT contract_id,number,version FROM contract_number_claims ORDER BY contract_id')).toEqual([{ contract_id: 'old-duplicate', number: 'OLD-SAME', version: '1' }, { contract_id: 'old-main', number: 'OLD-SAME', version: '1' }])
    expect(await storage.select('SELECT contract_id,number,version FROM contract_number_history ORDER BY contract_id,version')).toEqual([{ contract_id: 'old-duplicate', number: 'OLD-SAME', version: '1' }, { contract_id: 'old-main', number: 'OLD-SAME', version: '1' }, { contract_id: 'old-main', number: 'PENDING-EDIT', version: '2' }])
    await storage.withTransaction(tx => validateMaterialContractIdentities(tx, records))
    const before = await storage.select('SELECT * FROM contract_number_history ORDER BY id')
    await storage.close()
    await assertCurrentOwnerStructure(storage)
    expect(await storage.select('SELECT * FROM contract_number_history ORDER BY id')).toEqual(before)
  }
  finally { await storage.close() }
})

it('既有客户v1库经同事务升级加入全部当前领域，客户参与者和原事实不被替换', async () => {
  const base = resolve('.tmp/a03-storage-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/upgrade-`)
  const raw = new DatabaseSync(join(directory, 'ruihang.sqlite'))
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  raw.prepare('INSERT INTO production_metadata VALUES(1,1,?,?,?,?)').run('upgrade-workspace', 'upgrade-owner', 'verification', '2026-09-22T00:00:00.000Z')
  raw.exec('CREATE TABLE preserved_specimen(id TEXT PRIMARY KEY, value TEXT NOT NULL)')
  raw.prepare('INSERT INTO preserved_specimen VALUES(?,?)').run('existing-fact', '客户库既有事实')
  raw.prepare('INSERT INTO customers(id,name,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('old-customer', '原客户姓名\n保留原文', 'active', 1, '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z')
  const originalBytes = new Uint8Array([0, 10, 128, 255])
  raw.prepare('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)').run('old-original', 'customer', 'old-customer', '原件.bin', originalBytes.length, 'application/octet-stream', 'historical-actor', '2026-09-22T00:00:00.000Z')
  raw.prepare('INSERT INTO file_payloads VALUES(?,?,?)').run('old-original', originalBytes, createHash('sha256').update(originalBytes).digest('hex'))
  const oldCustomer = raw.prepare('SELECT * FROM customers').all()
  const oldOriginal = raw.prepare('SELECT * FROM file_refs').all()
  const oldPayload = raw.prepare('SELECT * FROM file_payloads').all()
  raw.close()
  const storage = createProductionStorage({ directory, workspaceId: 'upgrade-workspace', ownerId: 'upgrade-owner', purpose: 'verification' })
  try {
    await assertCurrentOwnerStructure(storage)
    expect(await storage.select('SELECT * FROM preserved_specimen')).toEqual([{ id: 'existing-fact', value: '客户库既有事实' }])
    expect(await storage.select('SELECT * FROM customers')).toEqual(oldCustomer)
    expect(await storage.select('SELECT * FROM file_refs')).toEqual(oldOriginal)
    expect(await storage.select('SELECT * FROM file_payloads')).toEqual(oldPayload)
    expect(await storage.select('SELECT * FROM notification_revision')).toEqual([{ singleton: 1, revision: 0, evaluated_at: null, supplier_source_version: null }])
    expect(await storage.select('SELECT * FROM notification_events')).toEqual([])
    expect(await storage.select('SELECT * FROM our_signatory_revision')).toEqual([{ singleton: 1, revision: 0 }])
    for (const table of ['our_signatories', 'our_signatory_history', 'our_signatory_commands', 'our_signatory_resolutions', 'contract_number_claims', 'contract_number_history'])
      expect(await storage.select(`SELECT * FROM ${table}`)).toEqual([])
    await assertFrozenHistoryGuards(storage)
    const schema = await storage.select('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')
    await storage.close()
    await assertCurrentOwnerStructure(storage)
    expect(await storage.select('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')).toEqual(schema)
    expect(await storage.select('SELECT * FROM customers')).toEqual(oldCustomer)
    expect(await storage.select('SELECT * FROM file_payloads')).toEqual(oldPayload)
  }
  finally { await storage.close() }
})

it('升级中途失败保持旧版本和完整旧参与者，未知参与者不会被自动抹掉', async () => {
  const base = resolve('.tmp/a03-storage-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/failed-upgrade-`)
  const path = join(directory, 'ruihang.sqlite')
  const raw = new DatabaseSync(path)
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  raw.prepare('INSERT INTO production_metadata VALUES(1,1,?,?,?,?)').run('upgrade-workspace', 'upgrade-owner', 'verification', '2026-09-22T00:00:00.000Z')
  raw.exec('CREATE TABLE process_library_command_receipts(synthetic TEXT)')
  raw.close()
  const options = { directory, workspaceId: 'upgrade-workspace', ownerId: 'upgrade-owner', purpose: 'verification' as const }
  await expect(createProductionStorage(options).status()).rejects.toThrow('无法初始化')
  const inspected = new DatabaseSync(path)
  try {
    expect(inspected.prepare('SELECT schema_version FROM production_metadata').get()?.schema_version).toBe(1)
    expect(inspected.prepare('SELECT * FROM production_participants').all()).toEqual([{ domain: 'customer', schema_version: 1 }])
    expect(inspected.prepare('SELECT name FROM sqlite_master WHERE name IN (?,?)').all('process_library_revision', 'process_library_versions')).toEqual([])
    inspected.exec('DROP TABLE process_library_command_receipts')
    inspected.exec('INSERT INTO production_participants VALUES (\'unknown-domain\',1)')
  }
  finally { inspected.close() }
  await expect(createProductionStorage(options).status()).rejects.toThrow('参与者清单')
})

it('参与者登记仍在但实际审计表缺失时，冷打开明确拒绝而非报告已就绪', async () => {
  const base = resolve('.tmp/a03-storage-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/missing-table-`)
  const options = { directory, workspaceId: 'missing-table-workspace', ownerId: 'missing-table-owner', purpose: 'verification' as const }
  const first = createProductionStorage(options)
  await first.status()
  await first.close()
  const raw = new DatabaseSync(join(directory, 'ruihang.sqlite'))
  raw.exec('DROP TABLE customer_audits')
  raw.close()
  await expect(createProductionStorage(options).status()).rejects.toThrow('业务表')
})

it('v10至v12保原finance清单，v13只向同一参与者追加冻结核验，不回写旧版本清单', () => {
  const originalFinanceTables = [
    'current_transactions',
    'expense_reimbursements',
    'expense_reimbursement_lines',
    'invoice_applications',
    'payment_applications',
    'payment_records',
    'payment_application_settlement_allocations',
    'payment_application_invoice_allocations',
    'payment_record_application_allocations',
    'operation_logs',
    'finance_versions',
    'finance_history',
    'finance_revision',
    'finance_commands',
    'finance_resolutions',
    'finance_imports',
    'finance_import_resolutions',
  ]
  for (const version of [10, 11, 12])
    expect(productionStorageManifest(version).participants.finance).toEqual({ schemaVersion: 1, tables: originalFinanceTables })
  const before = productionStorageManifest(12)
  const after = productionStorageManifest(13)
  expect(after.participants.finance).toEqual({ schemaVersion: 1, tables: [...originalFinanceTables, 'finance_payment_verifications'] })
  expect(Object.keys(after.participants).sort()).toEqual(Object.keys(before.participants).sort())
  for (const [domain, participant] of Object.entries(before.participants)) {
    if (domain !== 'finance')
      expect(after.participants[domain]).toEqual(participant)
  }
})

it('真实v12升级核验表冲突保整份旧库；核实处理冲突后重试保留旧零、空值、银行原文且不补造核验', async () => {
  const base = resolve('.tmp/a03-storage-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/v12-verification-upgrade-`)
  const path = join(directory, 'ruihang.sqlite')
  const raw = new DatabaseSync(path)
  raw.exec('BEGIN')
  raw.exec(PRODUCTION_STORAGE_SCHEMA)
  for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 12)) raw.exec(upgrade.sql)
  raw.prepare('INSERT INTO production_metadata VALUES(1,12,?,?,?,?)').run('verification-upgrade-workspace', 'verification-upgrade-owner', 'verification', '2026-10-01T00:00:00.000Z')
  const historicalApplications = [
    ['legacy-unknown', '旧原文\n批复未知', 10000, 0, 'legacy'],
    ['explicit-zero', '明确零元', 100, 0, 'user-entry'],
    ['not-entered', '未填写', 100, null, 'user-entry'],
    ['known-nonzero', '真实历史金额', 100, 0.1000001, 'legacy'],
  ]
  for (const values of historicalApplications)
    raw.prepare('INSERT INTO payment_applications(id,name,apply_amount,approved_amount,approved_amount_origin) VALUES(?,?,?,?,?)').run(...values)
  raw.prepare(`INSERT INTO payment_records(id,amount,payee_name,payment_date,voucher_no,bank_serial_no,confirmation_status,confirmed_by,confirmed_at,note)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run('historical-cash', 3000, '原银行收款人\n', '2026-10-01', '真实旧回单', 'old-bank-proof', 'draft', '原确认人', '2026-10-01T01:00:00.000Z', '银行原文\t保留')
  raw.prepare('INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES(?,?,?,?)').run('historical-cash-allocation', 'historical-cash', 'legacy-unknown', 3000)
  raw.exec('UPDATE payment_records SET confirmation_status=\'confirmed\' WHERE id=\'historical-cash\'')
  raw.exec('CREATE TABLE finance_payment_verifications(unclassified_evidence TEXT NOT NULL)')
  raw.prepare('INSERT INTO finance_payment_verifications VALUES(?)').run('已有独有资料不能自动清除')
  const oldSchema = raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()
  const oldApplications = raw.prepare('SELECT * FROM payment_applications ORDER BY id').all()
  const oldCash = raw.prepare('SELECT * FROM payment_records').all()
  const oldAllocations = raw.prepare('SELECT * FROM payment_record_application_allocations').all()
  const oldParticipants = raw.prepare('SELECT * FROM production_participants ORDER BY domain').all()
  raw.exec('COMMIT')
  raw.close()
  const options = { directory, workspaceId: 'verification-upgrade-workspace', ownerId: 'verification-upgrade-owner', purpose: 'verification' as const }
  const failed = createProductionStorage(options)
  await expect(failed.status()).rejects.toThrow('无法初始化')
  // A failed initializer has closed its raw driver; close() would retry that failed upgrade.
  const preserved = new DatabaseSync(path)
  try {
    expect(preserved.prepare('SELECT schema_version FROM production_metadata').get()?.schema_version).toBe(12)
    expect(preserved.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(oldSchema)
    expect(preserved.prepare('SELECT * FROM payment_applications ORDER BY id').all()).toEqual(oldApplications)
    expect(preserved.prepare('SELECT * FROM payment_records').all()).toEqual(oldCash)
    expect(preserved.prepare('SELECT * FROM payment_record_application_allocations').all()).toEqual(oldAllocations)
    expect(preserved.prepare('SELECT * FROM production_participants ORDER BY domain').all()).toEqual(oldParticipants)
    expect(preserved.prepare('SELECT * FROM finance_payment_verifications').all()).toEqual([{ unclassified_evidence: '已有独有资料不能自动清除' }])
    // This synthetic conflict is explicitly resolved in the test; production never deletes it automatically.
    preserved.exec('DROP TABLE finance_payment_verifications')
  }
  finally { preserved.close() }
  const retried = createProductionStorage(options)
  try {
    expect((await retried.status()).schemaVersion).toBe(28)
    expect(await retried.select('SELECT * FROM payment_applications ORDER BY id')).toEqual(oldApplications)
    expect(await retried.select('SELECT * FROM payment_records')).toEqual(oldCash)
    expect(await retried.select('SELECT * FROM payment_record_application_allocations')).toEqual(oldAllocations)
    expect(await retried.select('SELECT * FROM production_participants ORDER BY domain')).toEqual(participantsAfterOpt02(oldParticipants))
    expect(await retried.select('SELECT * FROM finance_payment_verifications')).toEqual([])
    expect(await retried.select('PRAGMA foreign_key_check')).toEqual([])
    await retried.close()
    expect((await retried.status()).schemaVersion).toBe(28)
    expect(await retried.select('SELECT * FROM payment_applications ORDER BY id')).toEqual(oldApplications)
    expect(await retried.select('SELECT * FROM payment_records')).toEqual(oldCash)
    expect(await retried.select('SELECT * FROM finance_payment_verifications')).toEqual([])
  }
  finally { await retried.close() }
})

it('v14只在既有Finance与Other参与者追加核定和明确采用关系，历史v13清单及其他领域不变', () => {
  const original = productionStorageManifest(13)
  const current = productionStorageManifest(14)
  expect(current.participants.finance).toEqual({
    schemaVersion: 1,
    tables: [...original.participants.finance!.tables, 'finance_expense_clearance_verifications'],
  })
  expect(current.participants['other-settlements']).toEqual({
    schemaVersion: 1,
    tables: [...original.participants['other-settlements']!.tables, 'expenditure_settlement_clearance_links'],
  })
  expect(Object.keys(current.participants).sort()).toEqual(Object.keys(original.participants).sort())
  for (const [domain, participant] of Object.entries(original.participants)) {
    if (domain !== 'finance' && domain !== 'other-settlements')
      expect(current.participants[domain]).toEqual(participant)
  }
  expect(productionStorageManifest(13)).toEqual(original)
})

const v13PreservedTables = ['expense_reimbursements', 'expense_reimbursement_lines', 'payment_applications', 'payment_records', 'payment_record_application_allocations', 'file_refs', 'file_payloads', 'production_participants', 'finance_payment_verifications'] as const

async function seedV13ClearanceUpgrade(conflict?: 'finance_expense_clearance_verifications' | 'expenditure_settlement_clearance_links') {
  const base = resolve('.tmp/root-clearance-validation/shared-upgrade')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'v13-original-'))
  const path = join(directory, 'ruihang.sqlite')
  const raw = new DatabaseSync(path)
  try {
    raw.exec('BEGIN')
    raw.exec(PRODUCTION_STORAGE_SCHEMA)
    for (const upgrade of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 13)) raw.exec(upgrade.sql)
    raw.prepare('INSERT INTO production_metadata VALUES(1,13,?,?,?,?)').run('clearance-upgrade-workspace', 'clearance-upgrade-owner', 'verification', '2026-10-05T00:00:00.000Z')
    // These original rows protect upgrade preservation, not eligibility of unresolved legacy identities.
    raw.prepare('INSERT INTO expense_reimbursements(id,no,applicant,status,note) VALUES(?,?,?,?,?)').run('expense-original-head', '原费用原文', '原垫付人文本', 'confirmed', '原头\n不回写')
    raw.prepare('INSERT INTO expense_reimbursements(id,no,applicant,status,note) VALUES(?,?,?,?,?)').run('clearance-original-head', '原清偿原文', '原垫付人文本', 'confirmed', '原纸缺失，不能冒充找回')
    raw.prepare('INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount) VALUES(?,?,?,?)').run('expense-original-line', 'expense-original-head', '设备维修费', 100)
    raw.prepare('INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,original_expense_line_id,note) VALUES(?,?,?,?,?,?)').run('clearance-original-line', 'clearance-original-head', '原清偿份额', 30, 'expense-original-line', '明确原行关系，不代表银行实付')
    for (const [id, amount, origin] of [['old-unknown-approval', 0, 'legacy'], ['old-explicit-zero', 0, 'user-entry'], ['old-empty-approval', null, 'user-entry']] as const)
      raw.prepare('INSERT INTO payment_applications(id,name,apply_amount,approved_amount,approved_amount_origin) VALUES(?,?,?,?,?)').run(id, '原批复不得由升级重算', 10000, amount, origin)
    raw.prepare('INSERT INTO payment_records(id,amount,payee_name,payment_date,voucher_no,bank_serial_no,confirmation_status,confirmed_by,confirmed_at,note) VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-actual-bank', 3000, '原银行收款人\n', '2026-10-01', '真实旧回单', 'clearance-original-bank', 'draft', '原确认人', '2026-10-01T01:00:00.000Z', '与清偿30没有臆造关联')
    raw.prepare('INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES(?,?,?,?)').run('old-actual-allocation', 'old-actual-bank', 'old-unknown-approval', 3000)
    raw.exec('UPDATE payment_records SET confirmation_status=\'confirmed\' WHERE id=\'old-actual-bank\'')
    const bytes = Buffer.from([0, 10, 128, 255])
    raw.prepare('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)').run('old-original-file', 'expense_reimbursement', 'expense-original-head', '原费完整原件.bin', bytes.length, 'application/octet-stream', '原上传人', '2026-10-01')
    raw.prepare('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES(?,?,?)').run('old-original-file', bytes, createHash('sha256').update(bytes).digest('hex'))
    if (conflict) {
      raw.exec(`CREATE TABLE ${conflict}(unclassified_evidence TEXT NOT NULL)`)
      raw.prepare(`INSERT INTO ${conflict} VALUES(?)`).run('已有独有证据不能自动清除')
    }
    const rows = Object.fromEntries(v13PreservedTables.map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const schema = raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()
    raw.exec('COMMIT')
    return { directory, path, rows, schema }
  }
  finally { raw.close() }
}

it.each([null, 'finance_expense_clearance_verifications', 'expenditure_settlement_clearance_links'] as const)('真实v13追加核定与采用关系：冲突%s保全原库，显式处理后升级及冷恢复不改原费、清偿、批复、现金或原件', async (conflict) => {
  const graph = await seedV13ClearanceUpgrade(conflict ?? undefined)
  const options = { directory: graph.directory, workspaceId: 'clearance-upgrade-workspace', ownerId: 'clearance-upgrade-owner', purpose: 'verification' as const }
  if (conflict) {
    await expect(createProductionStorage(options).status()).rejects.toThrow('无法初始化')
    const unchanged = new DatabaseSync(graph.path)
    try {
      expect(unchanged.prepare('SELECT schema_version FROM production_metadata').get()?.schema_version).toBe(13)
      expect(unchanged.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(graph.schema)
      for (const [table, rows] of Object.entries(graph.rows))
        expect(unchanged.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(rows)
      expect(unchanged.prepare(`SELECT * FROM ${conflict}`).all()).toEqual([{ unclassified_evidence: '已有独有证据不能自动清除' }])
      // Explicit removal is limited to the synthetic conflict, never production initialization.
      unchanged.exec(`DROP TABLE ${conflict}`)
    }
    finally { unchanged.close() }
  }
  const upgraded = createProductionStorage(options)
  try {
    for (const cold of [false, true]) {
      if (cold)
        await upgraded.close()
      expect((await upgraded.status()).schemaVersion).toBe(28)
      for (const [table, rows] of Object.entries(graph.rows)) {
        if (table === 'production_participants')
          expect(await upgraded.select('SELECT * FROM production_participants ORDER BY domain')).toEqual(participantsAfterOpt02(rows))
        else
          expect(await upgraded.select(`SELECT * FROM ${table} ORDER BY rowid`)).toEqual(rows)
      }
      expect(await upgraded.select('SELECT * FROM finance_expense_clearance_verifications')).toEqual([])
      expect(await upgraded.select('SELECT * FROM expenditure_settlement_clearance_links')).toEqual([])
      expect(await upgraded.select('PRAGMA foreign_key_check')).toEqual([])
    }
  }
  finally { await upgraded.close() }
})

it('既有v14主档升级后只读虚拟列保原JSON、删除事实、未知扩展和真实零，冷开不新建身份', async () => {
  const base = resolve('.tmp/opt02-master-projection')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'v14-'))
  const path = join(directory, 'ruihang.sqlite')
  const raw = new DatabaseSync(path)
  const timestamp = '2026-10-07T00:00:00.000Z'
  const records = [
    { id: 'zero-wage-worker', deletedAt: null, version: 1, updatedAt: timestamp, extension: { original: 'Aa\n保原文' }, draft: { id: 'zero-wage-worker', name: '真实零', dailyWage: 0, crewId: null, currentProjectId: 'project-reuse-original' } },
    { id: 'unknown-wage-worker', deletedAt: null, version: 1, updatedAt: timestamp, draft: { id: 'unknown-wage-worker', name: '未知', dailyWage: null, crewId: null } },
    { id: 'deleted-original-worker', deletedAt: timestamp, version: 1, updatedAt: timestamp, draft: { id: 'deleted-original-worker', name: '已删除原身份', dailyWage: 200, crewId: null } },
  ]
  try {
    raw.exec(PRODUCTION_STORAGE_SCHEMA)
    for (const step of PRODUCTION_STORAGE_UPGRADES.filter(step => step.to <= 14)) raw.exec(step.sql)
    raw.prepare('INSERT INTO production_metadata VALUES(1,14,?,?,?,?)').run('projection-workspace', 'projection-owner', 'verification', timestamp)
    for (const record of records)
      raw.prepare('INSERT INTO workers(id,record_json) VALUES(?,?)').run(record.id, JSON.stringify(record))
  }
  finally { raw.close() }
  const options = { directory, workspaceId: 'projection-workspace', ownerId: 'projection-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  try {
    for (const cold of [false, true]) {
      if (cold)
        await storage.close()
      expect(await storage.select('SELECT id,record_json FROM workers ORDER BY id')).toEqual(records.map(record => ({ id: record.id, record_json: JSON.stringify(record) })).sort((left, right) => left.id.localeCompare(right.id)))
      expect(await storage.select('SELECT id,daily_wage,deleted_at,current_project_id FROM workers ORDER BY id')).toEqual([
        { id: 'deleted-original-worker', daily_wage: 200, deleted_at: timestamp, current_project_id: null },
        { id: 'unknown-wage-worker', daily_wage: null, deleted_at: null, current_project_id: null },
        { id: 'zero-wage-worker', daily_wage: 0, deleted_at: null, current_project_id: 'project-reuse-original' },
      ])
      await expect(storage.execute('UPDATE workers SET name=? WHERE id=?', ['不得写第二主档', 'zero-wage-worker'])).rejects.toThrow(/generated/)
    }
  }
  finally { await storage.close() }
})
