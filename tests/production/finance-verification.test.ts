import type { SQLInputValue } from 'node:sqlite'
import type { FinanceCommand } from '../../app/lib/finance/central-contract'
import type { PaymentVerificationEdit } from '../../app/lib/finance/payment-verification'
import type { ProductionStorage } from '../../server/utils/production-storage'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { FINANCE_FAMILIES, financeFailure } from '../../app/lib/finance/central-contract'
import { createFinanceCommandActions } from '../../app/lib/finance/command-session'
import { createFinanceRepository } from '../../app/lib/finance/http-repository'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { copyBackupPackage, createLocalBackup, readBackupPackage, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { financeCommandFingerprint } from '../../server/utils/production-finance-request'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { PRODUCTION_FINANCE_VERIFICATION_SCHEMA } from '../../server/utils/production-finance-verification-schema'
import { createProductionOtherSettlementMigration } from '../../server/utils/production-other-settlement-migration'
import { listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { PRODUCTION_STORAGE_UPGRADES, productionStorageManifest } from '../../server/utils/production-storage-schema'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { runColdProcess } from '../helpers/cold-process'
import { createOtherSettlementPay08Source } from '../helpers/other-settlement-pay08-source'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

/** Only synthetic, unused later domains are removed to model the exact historical backup release. */
function historicalFixtureSchema(db: DatabaseSync, version: 12 | 13) {
  const currentVersion = Number(db.prepare('SELECT schema_version FROM production_metadata WHERE singleton=1').get()!.schema_version)
  const current = productionStorageManifest(currentVersion)
  const historical = productionStorageManifest(version)
  const historicalTables = new Set([...historical.coreTables, ...Object.values(historical.participants).flatMap(participant => participant.tables)])
  const added = [...new Set(Object.values(current.participants).flatMap(participant => participant.tables))].filter(table => !historicalTables.has(table))
  const untouchedRevisionTables = new Set(['payroll_revision', 'construction_contract_revision', 'construction_scope_revision', 'subcontract_contract_revision', 'auxiliary_contract_revision', 'boq_revision', 'invoice_revision', 'invoice_correction_revision'])
  for (const table of added) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all()
    expect(rows).toEqual(table === 'finance_contract_upgrade_anchor'
      ? [{ singleton: 1, legacy_history_count: 0 }]
      : untouchedRevisionTables.has(table) ? [{ singleton: 1, revision: 0 }] : [])
  }
  db.exec('PRAGMA foreign_keys=OFF; BEGIN')
  try {
    // Construct pre-v31 synthetic frozen snapshots before taking the historical baseline; only remove fields that did not exist then.
    const historyGuard = String(db.prepare('SELECT sql FROM sqlite_schema WHERE type=\'trigger\' AND name=\'finance_history_no_update\'').get()!.sql)
    const paymentHistories = db.prepare('SELECT id,version,snapshot_json FROM finance_history WHERE kind=\'payment_application\'').all()
    db.exec('DROP TRIGGER finance_history_no_update')
    for (const row of paymentHistories) {
      const snapshot = JSON.parse(String(row.snapshot_json))
      expect(snapshot.head.contract_domain).toBeNull()
      expect(snapshot.head.contract_version).toBeNull()
      delete snapshot.head.contract_domain
      delete snapshot.head.contract_version
      db.prepare('UPDATE finance_history SET snapshot_json=? WHERE kind=\'payment_application\' AND id=? AND version=?').run(JSON.stringify(snapshot), row.id!, row.version!)
    }
    db.exec(historyGuard)
    // v32 installs attachment guards on the older shared tables; remove only those synthetic later-version guards before dropping their empty owner tables.
    for (const trigger of ['invoice_correction_file_metadata', 'invoice_correction_file_no_delete', 'invoice_correction_payload_no_update', 'invoice_correction_payload_no_delete'])
      db.exec(`DROP TRIGGER ${trigger}`)
    for (const table of added.reverse()) db.exec(`DROP TABLE ${table}`)
    expect(db.prepare('SELECT id FROM payment_applications WHERE contract_domain IS NOT NULL OR contract_version IS NOT NULL').all()).toEqual([])
    db.exec('ALTER TABLE payment_applications DROP COLUMN contract_version')
    db.exec('ALTER TABLE payment_applications DROP COLUMN contract_domain')
    for (const table of ['crews', 'workers']) {
      const columns = db.prepare(`PRAGMA table_xinfo(${table})`).all().filter(column => Number(column.hidden) === 2)
      for (const column of columns) {
        expect(String(column.name)).toMatch(/^[a-z_]+$/)
        db.exec(`ALTER TABLE ${table} DROP COLUMN ${column.name}`)
      }
    }
    expect(db.prepare('SELECT id FROM projects WHERE matrix_archived_at IS NOT NULL').all()).toEqual([])
    db.exec('ALTER TABLE projects DROP COLUMN matrix_archived_at')
    for (const domain of Object.keys(current.participants).filter(domain => !historical.participants[domain]))
      db.prepare('DELETE FROM production_participants WHERE domain=?').run(domain)
    for (const [domain, participant] of Object.entries(historical.participants)) {
      expect(db.prepare('SELECT schema_version FROM production_participants WHERE domain=?').get(domain)).toEqual({ schema_version: current.participants[domain]!.schemaVersion })
      db.prepare('UPDATE production_participants SET schema_version=? WHERE domain=?').run(participant.schemaVersion, domain)
    }
    db.prepare('UPDATE production_metadata SET schema_version=? WHERE singleton=1').run(version)
    db.exec('COMMIT; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE')
  }
  catch (cause) {
    db.exec('ROLLBACK')
    throw cause
  }
}

async function fixture(companyContract = false) {
  const root = testTempRoot('a01-finance-production')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'pay08-synthetic-'))
  const native = await createOtherSettlementPay08Source(join(directory, 'native-source'))
  if (companyContract) {
    const raw = new DatabaseSync(native.path)
    try {
      raw.exec('PRAGMA foreign_keys=ON')
      raw.prepare('INSERT INTO company_expense_contracts(id,name,amount) VALUES(?,?,?)').run('pay08-source-company-contract', '原公司实际合同', 70)
      raw.prepare('UPDATE payment_applications SET company_expense_contract_id=? WHERE id=?').run('pay08-source-company-contract', native.ids.application)
    }
    finally { raw.close() }
    const bytes = await readFile(native.path)
    native.source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
  }
  const options = { directory, workspaceId: 'finance-pay08-workspace', ownerId: 'finance-pay08-owner', purpose: 'verification' as const }
  const storage = await createSeededProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['other-settlement:read', 'other-settlement:write', 'supplier:list:read', 'supplier:write', 'core:migration:write', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`])] }
  const session = () => structuredClone(actor)
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const supplier = createProductionSupplierService(storage)
  const bindings = []
  for (const [legacyId, name] of [[native.ids.service, '实际原服务方'], [native.ids.payee, '实际原垫付方']]) {
    const result = await supplier.execute({ ...identity, requiredCapability: 'supplier:write', commandId: `finance-pay08-supplier-${legacyId}`, baseVersion: null, action: 'save', attachments: {}, draft: { name, supplierCategory: '其他', contact: '合成联系人' } }, session)
    bindings.push({ legacyId: legacyId!, targetId: result.id })
  }
  const financeService = (owner = storage) => createProductionFinanceService(owner, { references: (tx, current) => ({ expenditure_settlements: id => readProductionOtherSettlementReference(tx, current, id), settlementCandidates: () => listProductionOtherSettlementReferences(tx, current) }) })
  const finance = financeService()
  const preview = await finance.preflightSnapshot({ ...identity, source: native.source }, session)
  const mappings = bindings.map((binding) => {
    const current = preview.candidates.find(row => row.entityType === 'suppliers' && row.serverId === binding.targetId)!
    return { entityType: 'suppliers' as const, ...binding, version: current.version, sourceVersion: current.sourceVersion, reason: '逐条核对原实际服务方、垫付方和原件' }
  })
  await finance.importSnapshot({ ...identity, source: native.source, mappings, commandId: 'finance-pay08-import' }, session)
  await createProductionOtherSettlementMigration(storage).importSnapshot({ ...identity, source: native.source, mappings, commandId: 'finance-pay08-other-import' }, session)
  const edit: PaymentVerificationEdit = { actualDueAmount: 70, cumulativePayableAmount: 70, basis: '原费用100、已确认结算采用70、原已付20及实际原件逐条核验', fileIds: [native.ids.applicationFile] }
  const verify = async (commandId: string, value = edit): Promise<FinanceCommand> => ({ ...identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', id: native.ids.application, baseVersion: (await finance.form('payment_application', native.ids.application, session)).version, commandId, action: 'save', attachments: {}, draft: { id: native.ids.application, verificationEdit: value } })
  const payeeId = bindings.find(row => row.legacyId === native.ids.payee)!.targetId
  const payment = (commandId: string): FinanceCommand => ({ ...identity, requiredCapability: 'finance-payment-record:write', kind: 'payment_record', commandId, baseVersion: null, action: 'confirm', attachments: {}, draft: { supplierId: payeeId, payeeName: '实际原垫付方', amount: 30, paymentDate: '2026-10-05', voucherNo: 'PAY08-NEW-VOUCHER', bankSerialNo: 'PAY08-NEW-BANK', confirmedBy: actor.actorId, applicationAllocations: [{ paymentApplicationId: native.ids.application, allocatedAmount: 30 }] } })
  return { directory, options, storage, actor, session, native, financeService, finance, edit, verify, payment }
}

it('实际v12旧17表备份可只读核验、离线复制及隔离恢复，不猜业务核验、不改旧批复现金和原件', { timeout: 20000 }, async () => {
  const f = await fixture()
  try {
    const staging = join(f.directory, 'old-staging')
    const offline = join(f.directory, 'old-offline')
    const restore = join(f.directory, 'old-restore')
    for (const path of [staging, offline, restore]) await mkdir(path)
    const id = `backup-${randomUUID()}`
    const packageDirectory = join(staging, id)
    await mkdir(packageDirectory)
    const path = join(packageDirectory, 'data.sqlite')
    await f.storage.backupTo(path)
    // This isolated synthetic snapshot models the exact previous schema; no business row or old receipt is changed.
    const raw = new DatabaseSync(path)
    let frozenHistory: unknown[] = []
    let frozenCommands: unknown[] = []
    try {
      expect(raw.prepare('SELECT COUNT(*) AS n FROM finance_expense_clearance_verifications').get()).toEqual({ n: 0 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM expenditure_settlement_clearance_links').get()).toEqual({ n: 0 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM finance_payment_verifications').get()).toEqual({ n: 0 })
      historicalFixtureSchema(raw, 12)
      frozenHistory = raw.prepare('SELECT kind,id,version,command_id,actor_id,occurred_at,snapshot_json FROM finance_history ORDER BY kind,id,version').all()
      frozenCommands = raw.prepare('SELECT * FROM finance_commands ORDER BY command_id').all()
    }
    finally { raw.close() }
    const before = await readFile(path)
    const inventory = await inspectProductionBackup(path)
    expect(inventory.schemaVersion).toBe(12)
    expect(inventory.participants.finance!.tables).toHaveLength(17)
    expect(inventory.tables).not.toHaveProperty('finance_payment_verifications')
    expect(inventory.originals).toEqual({ files: 2, bytes: 8 })
    expect((await readFile(path)).equals(before)).toBe(true)
    const manifest = { format: 'ruihang-backup-v1', id, capturedAt: '2026-10-05T00:00:00.000Z', completedAt: '2026-10-05T00:00:00.000Z', inventory }
    await writeFile(join(packageDirectory, 'manifest.json'), JSON.stringify(manifest))
    expect(await readBackupPackage(staging, id)).toEqual(manifest)
    expect(await copyBackupPackage(staging, offline, id)).toEqual(manifest)
    const recovered = await restoreBackupIsolated(offline, id, restore, 'pay08-old-isolated')
    expect(recovered.inventory).toEqual(inventory)
    const recoveredStorage = createProductionStorage({ ...f.options, directory: recovered.directory })
    try {
      await recoveredStorage.status()
      expect(await recoveredStorage.select('SELECT kind,id,version,command_id,actor_id,occurred_at,snapshot_json FROM finance_history ORDER BY kind,id,version')).toEqual(frozenHistory)
      expect(await recoveredStorage.select('SELECT * FROM finance_commands ORDER BY command_id')).toEqual(frozenCommands)
      await expect(validateFinanceJournal(recoveredStorage, f.actor)).resolves.toBeDefined()
      const service = f.financeService(recoveredStorage)
      expect((await service.form('payment_application', f.native.ids.application, f.session)).draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 20, paymentVerification: { required: true, status: 'missing', proof: null } })
      expect(await recoveredStorage.select('SELECT * FROM finance_payment_verifications')).toEqual([])
      expect((await service.original('payment_application', f.native.ids.application, f.native.ids.applicationFile, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
      await expect(service.execute(f.payment('pay08-old-still-needs-proof'), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      expect(await recoveredStorage.select('SELECT amount,bank_serial_no,confirmed_by FROM payment_records WHERE id=?', [f.native.ids.payment])).toEqual([{ amount: 20, bank_serial_no: 'PAY08-OLD-BANK', confirmed_by: '原确认人' }])
    }
    finally { await recoveredStorage.close() }
    expect((await readFile(path)).equals(before)).toBe(true)
  }
  finally { await f.storage.close() }
})

async function historicalVerificationFixture() {
  const f = await fixture()
  try {
    const request = await f.verify('pay08-backup-verification')
    const staging = join(f.directory, 'proof-staging')
    const offline = join(f.directory, 'proof-offline')
    const restore = join(f.directory, 'proof-restore')
    for (const path of [staging, offline, restore]) await mkdir(path)
    const backup = await createLocalBackup(f.storage, staging, `backup-${randomUUID()}`, () => '2026-10-05T01:00:00.000Z')
    // Build a v13 synthetic clone before issuing its verification, so its proof is generated against the genuine old physical columns.
    const historicalPath = join(staging, backup.id, 'data.sqlite')
    const historical = new DatabaseSync(historicalPath)
    try {
      expect(historical.prepare('SELECT COUNT(*) AS n FROM finance_expense_clearance_verifications').get()).toEqual({ n: 0 })
      expect(historical.prepare('SELECT COUNT(*) AS n FROM expenditure_settlement_clearance_links').get()).toEqual({ n: 0 })
      expect(historical.prepare('SELECT COUNT(*) AS n FROM finance_payment_verifications').get()).toEqual({ n: 0 })
      historicalFixtureSchema(historical, 13)
    }
    finally { historical.close() }
    const oldDb = new DatabaseSync(historicalPath, { enableForeignKeyConstraints: true })
    const coordinator = createDbCoordinator(async () => ({
      async execute(sql, params) {
        if (params)
          oldDb.prepare(sql).run(...params as SQLInputValue[])
        else oldDb.exec(sql)
      },
      async select<T>(sql: string, params: unknown[] = []) { return oldDb.prepare(sql).all(...params as SQLInputValue[]) as T[] },
      async close() { oldDb.close() },
    }))
    const oldStorage = { ...coordinator, identity: { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId }, assertBusinessWrite() {} } as ProductionStorage
    const { result, actualRead, frozenHistory, frozenCommands, frozenProof } = await (async () => {
      try {
        const oldFinance = f.financeService(oldStorage)
        const result = await oldFinance.execute(request, f.session)
        const actualRead = await oldFinance.form('payment_application', f.native.ids.application, f.session)
        await validateFinanceJournal(oldStorage, f.actor)
        const frozenHistory = await oldStorage.select('SELECT * FROM finance_history ORDER BY kind,id,version')
        const frozenCommands = await oldStorage.select('SELECT * FROM finance_commands ORDER BY command_id')
        const frozenProof = await oldStorage.select('SELECT * FROM finance_payment_verifications ORDER BY id')
        return { result, actualRead, frozenHistory, frozenCommands, frozenProof }
      }
      finally { await oldStorage.close() }
    })()
    return { f, request, staging, offline, restore, backup, historicalPath, result, actualRead, frozenHistory, frozenCommands, frozenProof }
  }
  catch (cause) {
    await f.storage.close()
    throw cause
  }
}

it('实际v13核验版本进入备份与冷恢复，原件、可信核验人与结论保真且只增加确认现金', { timeout: 20000 }, async () => {
  const { f, request, staging, offline, restore, backup, historicalPath, result, actualRead, frozenHistory, frozenCommands, frozenProof } = await historicalVerificationFixture()
  try {
    const before = actualRead.draft.paymentVerification!
    expect((await createFinanceRepository(async () => actualRead).form('payment_application', f.native.ids.application)).draft.paymentVerification).toEqual(before)
    const invalidActor = structuredClone(actualRead)
    invalidActor.draft.paymentVerification!.proof!.actorId = 'another-pay08-owner'
    const invalidVersion = structuredClone(actualRead)
    invalidVersion.draft.paymentVerification!.proof!.applicationVersion = '999'
    const invalidSource = structuredClone(actualRead)
    invalidSource.draft.paymentVerification!.proof!.sources[0]!.sourceVersion = 'other-settlement-record-999'
    const invalidState = structuredClone(actualRead)
    invalidState.draft.paymentVerification!.status = 'missing'
    for (const invalid of [invalidActor, invalidVersion, invalidSource, invalidState])
      await expect(createFinanceRepository(async () => invalid).form('payment_application', f.native.ids.application)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    for (const sha of [null, 0, 'unknown', 'A'.repeat(64)])
      await expect(createFinanceRepository(async () => ({ ...result, paymentVerificationSha256: sha })).execute(request)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    backup.inventory = await inspectProductionBackup(historicalPath)
    await writeFile(join(staging, backup.id, 'manifest.json'), JSON.stringify(backup))
    expect(backup.inventory.schemaVersion).toBe(13)
    expect(backup.inventory.participants.finance!.tables).toHaveLength(18)
    expect(backup.inventory.tables.finance_payment_verifications!.rows).toBe(1)
    expect(backup.inventory.originals).toEqual({ files: 2, bytes: 8 })
    expect(await readBackupPackage(staging, backup.id)).toEqual(backup)
    expect(await copyBackupPackage(staging, offline, backup.id)).toEqual(backup)
    const restored = await restoreBackupIsolated(offline, backup.id, restore, 'pay08-proof-isolated')
    const recovered = createProductionStorage({ ...f.options, directory: restored.directory })
    try {
      const service = f.financeService(recovered)
      expect(await service.execute(request, f.session)).toEqual(result)
      expect(await recovered.select('SELECT * FROM finance_history ORDER BY kind,id,version')).toEqual(frozenHistory)
      expect(await recovered.select('SELECT * FROM finance_commands ORDER BY command_id')).toEqual(frozenCommands)
      expect(await recovered.select('SELECT * FROM finance_payment_verifications ORDER BY id')).toEqual(frozenProof)
      expect((await service.form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification).toEqual(before)
      expect(before.proof).toMatchObject({ actorId: f.actor.actorId, workspaceId: f.actor.workspaceId, actualDueAmount: 70, cumulativePayableAmount: 70, basis: f.edit.basis, fileIds: [f.native.ids.applicationFile] })
      const corruptDirectory = join(f.directory, 'non-null-synthetic-copy')
      await mkdir(corruptDirectory)
      await recovered.backupTo(join(corruptDirectory, 'ruihang.sqlite'))
      const corrupt = createProductionStorage({ ...f.options, directory: corruptDirectory })
      try {
        await corrupt.execute('UPDATE payment_applications SET contract_id=?,contract_domain=?,contract_version=? WHERE id=?', ['synthetic-id', 'material', '1', f.native.ids.application])
        await expect(validateFinanceJournal(corrupt, f.actor)).rejects.toThrow('财务版本、原命令、冻结记录、原件或迁入证据损坏')
        expect((await f.financeService(corrupt).form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification).toMatchObject({ status: 'stale', proof: null })
      }
      finally { await corrupt.close() }
      const paid = await service.execute(f.payment('pay08-restored-payment'), f.session)
      await recovered.close()
      expect(await service.execute(f.payment('pay08-restored-payment'), f.session)).toEqual(paid)
      expect(await recovered.select('SELECT COUNT(*) AS n,SUM(amount) AS total FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 2, total: 50 }])
      expect(await recovered.select('SELECT COUNT(*) AS n,SUM(amount) AS total FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ n: 1, total: 100 }])
      expect(await recovered.select('SELECT approved_amount,approved_amount_origin FROM payment_applications WHERE id=?', [f.native.ids.application])).toEqual([{ approved_amount: 0, approved_amount_origin: 'legacy' }])
      expect((await service.original('payment_application', f.native.ids.application, f.native.ids.applicationFile, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    }
    finally { await recovered.close() }
    const { stdout } = await runColdProcess('production-finance-cold', [restored.directory, JSON.stringify(f.actor)])
    const coldProof = JSON.parse(stdout)
    expect(coldProof).toEqual(frozenProof)
  }
  finally { await f.storage.close() }
})

it('实际v13核验版本升级至v30后保留原回执和冻结历史，后续核验追加而不覆盖', { timeout: 20000 }, async () => {
  const { f, request, historicalPath, result, frozenHistory, frozenCommands, frozenProof } = await historicalVerificationFixture()
  try {
    const v30Directory = join(f.directory, 'v30-synthetic-copy')
    await mkdir(v30Directory)
    const v30Path = join(v30Directory, 'ruihang.sqlite')
    await copyFile(historicalPath, v30Path, constants.COPYFILE_EXCL)
    const v30 = new DatabaseSync(v30Path, { enableForeignKeyConstraints: true })
    try {
      v30.exec('BEGIN')
      try {
        for (const step of PRODUCTION_STORAGE_UPGRADES.filter(step => step.from >= 13 && step.to <= 30)) {
          v30.exec(step.sql)
          v30.prepare('UPDATE production_metadata SET schema_version=? WHERE singleton=1').run(step.to)
        }
        v30.exec('COMMIT')
      }
      catch (error) {
        v30.exec('ROLLBACK')
        throw error
      }
    }
    finally { v30.close() }
    expect((await inspectProductionBackup(v30Path)).schemaVersion).toBe(30)
    const upgradedV30 = createProductionStorage({ ...f.options, directory: v30Directory })
    try {
      const upgradedService = f.financeService(upgradedV30)
      expect(await upgradedService.execute(request, f.session)).toEqual(result)
      await expect(upgradedService.execute({ ...request, draft: { id: f.native.ids.application, verificationEdit: { ...f.edit, basis: '同编号不同依据' } } }, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await upgradedV30.select('SELECT * FROM finance_history ORDER BY kind,id,version')).toEqual(frozenHistory)
      expect(await upgradedV30.select('SELECT * FROM finance_commands ORDER BY command_id')).toEqual(frozenCommands)
      expect(await upgradedV30.select('SELECT * FROM finance_payment_verifications ORDER BY id')).toEqual(frozenProof)
      await expect(validateFinanceJournal(upgradedV30, f.actor)).resolves.toBeDefined()
      const current = await upgradedService.form('payment_application', f.native.ids.application, f.session)
      await upgradedService.execute({ ...request, commandId: 'v30-later-verification', baseVersion: current.version, draft: { id: f.native.ids.application, verificationEdit: { ...f.edit, basis: '升级后重新核验' } } }, f.session)
      const afterHistory = await upgradedV30.select<{ kind: string, id: string, version: number, snapshot_json: string }>('SELECT * FROM finance_history ORDER BY kind,id,version')
      for (const old of frozenHistory as { kind: string, id: string, version: number }[])
        expect(afterHistory.find(row => row.kind === old.kind && row.id === old.id && row.version === old.version)).toEqual(old)
      const latest = afterHistory.filter(row => row.kind === 'payment_application' && row.id === f.native.ids.application).at(-1)!
      expect(JSON.parse(latest.snapshot_json).head).toMatchObject({ contract_domain: null, contract_version: null })
      await expect(validateFinanceJournal(upgradedV30, f.actor)).resolves.toBeDefined()
    }
    finally { await upgradedV30.close() }
  }
  finally { await f.storage.close() }
})

it.each(['conclusion', 'source', 'recomputed-source', 'missing-proof', 'original'] as const)('真实备份%s证据损坏时拒绝包核验，原副本不被修写或猜回核验结论', { timeout: 15000 }, async (damage) => {
  const f = await fixture()
  try {
    await f.finance.execute(await f.verify(`pay08-corrupt-${damage}`), f.session)
    const path = join(f.directory, `proof-corrupt-${damage}.sqlite`)
    await f.storage.backupTo(path)
    const db = new DatabaseSync(path)
    try {
      if (damage === 'original') {
        db.prepare('DELETE FROM file_payloads WHERE file_ref_id=?').run(f.native.ids.applicationFile)
      }
      else if (damage === 'missing-proof') {
        db.exec('DROP TRIGGER finance_payment_verifications_no_delete; DELETE FROM finance_payment_verifications')
        db.exec(PRODUCTION_FINANCE_VERIFICATION_SCHEMA.slice(PRODUCTION_FINANCE_VERIFICATION_SCHEMA.indexOf('CREATE TRIGGER finance_payment_verifications_no_delete')))
      }
      else {
        const row = db.prepare('SELECT id,proof_json FROM finance_payment_verifications').get()!
        const proof = JSON.parse(String(row.proof_json))
        if (damage === 'conclusion')
          proof.cumulativePayableAmount = 69
        else proof.sources[0].evidenceJson = JSON.stringify({ ...JSON.parse(proof.sources[0].evidenceJson), total_amount: 700 })
        if (damage === 'recomputed-source')
          proof.sources[0].fingerprint = financeCommandFingerprint(JSON.parse(proof.sources[0].evidenceJson))
        db.exec('DROP TRIGGER finance_payment_verifications_no_update')
        db.prepare('UPDATE finance_payment_verifications SET proof_json=? WHERE id=?').run(JSON.stringify(proof), row.id!)
        const guard = PRODUCTION_FINANCE_VERIFICATION_SCHEMA.slice(PRODUCTION_FINANCE_VERIFICATION_SCHEMA.indexOf('CREATE TRIGGER finance_payment_verifications_no_update'), PRODUCTION_FINANCE_VERIFICATION_SCHEMA.indexOf('CREATE TRIGGER finance_payment_verifications_no_delete'))
        db.exec(guard)
      }
    }
    finally { db.close() }
    const bytes = await readFile(path)
    await expect(inspectProductionBackup(path)).rejects.toThrow('财务事实、原件、原命令、冻结历史或迁入依据不完整。')
    expect((await readFile(path)).equals(bytes)).toBe(true)
    expect((await f.finance.form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification).toMatchObject({ required: true, status: 'verified' })
  }
  finally { await f.storage.close() }
})

it('核验未知结果以原键冷恢复，可信applied后GET失败只读重试，权限切换保最小原键与私有输入', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    const storage = new Map<string, string>()
    const recovery = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }
    let posts = 0
    let resolves = 0
    let failRead = false
    let unknown = true
    const repository = createFinanceRepository(async (url, options) => {
      if (url.endsWith('/context'))
        return f.finance.context('payment_application', f.session)
      if (url.includes('/form/')) {
        if (failRead)
          financeFailure('unavailable', '独立注入已保存后读取失败')
        return f.finance.form('payment_application', f.native.ids.application, f.session)
      }
      if (url.includes('/files/')) {
        const file = await f.finance.original('payment_application', f.native.ids.application, f.native.ids.applicationFile, f.session)
        return Uint8Array.from(file.bytes).buffer
      }
      if (url === '/api/commands/finance/resolve') {
        resolves++
        const body = options!.body as { kind: 'payment_application', commandId: string }
        return f.finance.resolve(body.kind, body.commandId, f.session)
      }
      if (url === '/api/commands/finance') {
        posts++
        const result = await f.finance.execute(options!.body, f.session)
        if (unknown) {
          unknown = false
          financeFailure('unavailable', '独立注入事务已提交但响应未知')
        }
        return result
      }
      throw new Error('未登记的真实核验读取路径')
    })
    const actions = createFinanceCommandActions('payment_application', () => repository, () => recovery)
    const original = actions.createSession()
    await actions.hydrate(original, f.native.ids.application)
    const sent = { id: f.native.ids.application, verificationEdit: structuredClone(f.edit) }
    await expect(actions.saveForm(original, sent, 'save')).rejects.toThrow('响应未知')
    const commandId = original.pending!.id
    expect(posts).toBe(1)
    expect(resolves).toBe(0)
    expect(storage.size).toBe(1)
    const descriptor = JSON.parse([...storage.values()][0]!)
    expect(Object.keys(descriptor).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'targetId', 'workspaceId'])
    expect(descriptor).toMatchObject({ commandId, action: 'save', family: 'finance-payment-application', targetId: f.native.ids.application })
    expect([...storage.values()][0]).not.toContain(f.edit.basis)
    await f.storage.close()
    failRead = true
    const cold = actions.createSession()
    await expect(actions.hydrate(cold, f.native.ids.application)).rejects.toThrow('读取失败')
    expect(cold.pending).toMatchObject({ id: commandId, result: { id: f.native.ids.application, commandId } })
    expect(posts).toBe(1)
    expect(resolves).toBe(1)
    expect(storage.size).toBe(1)
    const originalCaps = [...f.actor.capabilities]
    f.actor.capabilities = originalCaps.filter(capability => capability !== 'finance-payment-application:write')
    await expect(actions.recover(cold)).rejects.toThrow('权限')
    expect(cold.context).toBeNull()
    expect(storage.size).toBe(1)
    f.actor.capabilities = originalCaps
    sent.verificationEdit.basis = '后来输入留在页面，不能代替已提交原依据'
    failRead = false
    const recovered = await actions.recover(cold)
    expect(recovered.outcome).toBe('applied')
    expect(recovered.form!.draft.paymentVerification).toMatchObject({ status: 'verified', proof: { commandId, basis: f.edit.basis } })
    expect(sent.verificationEdit.basis).toBe('后来输入留在页面，不能代替已提交原依据')
    expect(posts).toBe(1)
    expect(resolves).toBe(1)
    expect(storage.size).toBe(0)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_payment_verifications')).toEqual([{ n: 1 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS total FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, total: 20 }])
  }
  finally { await f.storage.close() }
})

it('并发核验版本冲突不新增结论，已知保存后读取失败保原键且不再resolve或POST', { timeout: 15000 }, async () => {
  const f = await fixture()
  try {
    const first = await f.verify('pay08-conflict-first')
    const second = { ...first, commandId: 'pay08-conflict-second', draft: { id: f.native.ids.application, verificationEdit: { ...f.edit, basis: '另一核验人当前依据' } } }
    await f.finance.execute(first, f.session)
    await expect(f.finance.execute(second, f.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_payment_verifications')).toEqual([{ n: 1 }])
    const registry = new Map<string, string>()
    const recovery = { getItem: (key: string) => registry.get(key) ?? null, setItem: (key: string, value: string) => registry.set(key, value), removeItem: (key: string) => registry.delete(key) }
    let failRead = false
    let posts = 0
    let resolves = 0
    const repository = createFinanceRepository(async (url, options) => {
      if (url.endsWith('/context'))
        return f.finance.context('payment_application', f.session)
      if (url.includes('/form/')) {
        if (failRead)
          financeFailure('unavailable', '真实保存后独立GET失败')
        return f.finance.form('payment_application', f.native.ids.application, f.session)
      }
      if (url.includes('/files/'))
        return Uint8Array.from(f.native.original).buffer
      if (url.endsWith('/resolve')) {
        resolves++
        const body = options!.body as { kind: 'payment_application', commandId: string }
        return f.finance.resolve(body.kind, body.commandId, f.session)
      }
      posts++
      const result = await f.finance.execute(options!.body, f.session)
      failRead = true
      return result
    })
    const actions = createFinanceCommandActions('payment_application', () => repository, () => recovery)
    const session = actions.createSession()
    await actions.hydrate(session, f.native.ids.application)
    await expect(actions.saveForm(session, { id: f.native.ids.application, verificationEdit: { ...f.edit, basis: '新核验版本原依据' } }, 'save')).rejects.toThrow('已保存待刷新')
    expect(session.pending!.result).not.toBeNull()
    expect(posts).toBe(1)
    expect(resolves).toBe(0)
    expect(registry.size).toBe(1)
    failRead = false
    expect((await actions.recover(session)).form!.draft.paymentVerification).toMatchObject({ status: 'verified', proof: { basis: '新核验版本原依据' } })
    expect(posts).toBe(1)
    expect(resolves).toBe(0)
    expect(registry.size).toBe(0)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_payment_verifications')).toEqual([{ n: 2 }])
  }
  finally { await f.storage.close() }
})

it('原公司费用合同未接真实owner时不能按无合同链旁路生成核验，原字段、回单草稿和旧现金保留', { timeout: 15000 }, async () => {
  const f = await fixture(true)
  try {
    expect(await f.storage.select('SELECT company_expense_contract_id,approved_amount,approved_amount_origin FROM payment_applications WHERE id=?', [f.native.ids.application])).toEqual([{ company_expense_contract_id: 'pay08-source-company-contract', approved_amount: 0, approved_amount_origin: 'legacy' }])
    await expect(f.finance.execute(await f.verify('pay08-company-contract-unavailable'), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT * FROM finance_payment_verifications')).toEqual([])
    await expect(f.finance.execute(f.payment('pay08-no-fake-company-proof'), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const request = { ...f.payment('pay08-company-voucher-draft'), action: 'draft' as const }
    await f.finance.execute(request, f.session)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records WHERE confirmation_status=\'draft\'')).toEqual([{ n: 1 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS total FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, total: 20 }])
  }
  finally { await f.storage.close() }
})
