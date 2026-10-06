import type { FinanceCommand } from '../../app/lib/finance/central-contract'
import type { PaymentVerificationEdit } from '../../app/lib/finance/payment-verification'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { FINANCE_FAMILIES, financeFailure } from '../../app/lib/finance/central-contract'
import { createFinanceCommandActions } from '../../app/lib/finance/command-session'
import { createFinanceRepository } from '../../app/lib/finance/http-repository'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { copyBackupPackage, createLocalBackup, readBackupPackage, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { financeCommandFingerprint } from '../../server/utils/production-finance-request'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { PRODUCTION_FINANCE_VERIFICATION_SCHEMA } from '../../server/utils/production-finance-verification-schema'
import { createProductionOtherSettlementMigration } from '../../server/utils/production-other-settlement-migration'
import { listProductionOtherSettlementReferences, readProductionOtherSettlementReference } from '../../server/utils/production-other-settlement-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createOtherSettlementPay08Source } from '../helpers/other-settlement-pay08-source'

async function fixture(companyContract = false) {
  const root = resolve('.tmp/a01-finance-production')
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
  const storage = createProductionStorage(options)
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
    try {
      expect(raw.prepare('SELECT COUNT(*) AS n FROM finance_expense_clearance_verifications').get()).toEqual({ n: 0 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM expenditure_settlement_clearance_links').get()).toEqual({ n: 0 })
      expect(raw.prepare('SELECT COUNT(*) AS n FROM finance_payment_verifications').get()).toEqual({ n: 0 })
      raw.exec('DROP TABLE expenditure_settlement_clearance_links; DROP TABLE finance_expense_clearance_verifications; DROP TABLE finance_payment_verifications; UPDATE production_metadata SET schema_version=12 WHERE singleton=1; PRAGMA journal_mode=DELETE')
    }
    finally { raw.close() }
    const before = await readFile(path)
    const inventory = await inspectProductionBackup(path)
    expect(inventory.schemaVersion).toBe(12)
    expect(inventory.participants.finance!.tables).toHaveLength(17)
    expect(inventory.tables).not.toHaveProperty('finance_payment_verifications')
    expect(inventory.originals).toEqual({ files: 2, bytes: 8 })
    expect(await readFile(path)).toEqual(before)
    const manifest = { format: 'ruihang-backup-v1', id, capturedAt: '2026-10-05T00:00:00.000Z', completedAt: '2026-10-05T00:00:00.000Z', inventory }
    await writeFile(join(packageDirectory, 'manifest.json'), JSON.stringify(manifest))
    expect(await readBackupPackage(staging, id)).toEqual(manifest)
    expect(await copyBackupPackage(staging, offline, id)).toEqual(manifest)
    const recovered = await restoreBackupIsolated(offline, id, restore, 'pay08-old-isolated')
    expect(recovered.inventory).toEqual(inventory)
    const recoveredStorage = createProductionStorage({ ...f.options, directory: recovered.directory })
    try {
      const service = f.financeService(recoveredStorage)
      expect((await service.form('payment_application', f.native.ids.application, f.session)).draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 20, paymentVerification: { required: true, status: 'missing', proof: null } })
      expect(await recoveredStorage.select('SELECT * FROM finance_payment_verifications')).toEqual([])
      expect((await service.original('payment_application', f.native.ids.application, f.native.ids.applicationFile, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
      await expect(service.execute(f.payment('pay08-old-still-needs-proof'), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      expect(await recoveredStorage.select('SELECT amount,bank_serial_no,confirmed_by FROM payment_records WHERE id=?', [f.native.ids.payment])).toEqual([{ amount: 20, bank_serial_no: 'PAY08-OLD-BANK', confirmed_by: '原确认人' }])
    }
    finally { await recoveredStorage.close() }
    expect(await readFile(path)).toEqual(before)
  }
  finally { await f.storage.close() }
})

it('实际v13核验版本进入备份与冷恢复，原件、可信核验人与结论保真且只增加确认现金', { timeout: 20000 }, async () => {
  const f = await fixture()
  try {
    const request = await f.verify('pay08-backup-verification')
    const result = await f.finance.execute(request, f.session)
    const actualRead = await f.finance.form('payment_application', f.native.ids.application, f.session)
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
    const staging = join(f.directory, 'proof-staging')
    const offline = join(f.directory, 'proof-offline')
    const restore = join(f.directory, 'proof-restore')
    for (const path of [staging, offline, restore]) await mkdir(path)
    const backup = await createLocalBackup(f.storage, staging, `backup-${randomUUID()}`, () => '2026-10-05T01:00:00.000Z')
    // Only this synthetic backup clone models actual v13; preserve its existing PAY08 proof and every business/original row.
    const historicalPath = join(staging, backup.id, 'data.sqlite')
    const historical = new DatabaseSync(historicalPath)
    try {
      expect(historical.prepare('SELECT COUNT(*) AS n FROM finance_expense_clearance_verifications').get()).toEqual({ n: 0 })
      expect(historical.prepare('SELECT COUNT(*) AS n FROM expenditure_settlement_clearance_links').get()).toEqual({ n: 0 })
      expect(historical.prepare('SELECT COUNT(*) AS n FROM finance_payment_verifications').get()).toEqual({ n: 1 })
      historical.exec('DROP TABLE expenditure_settlement_clearance_links; DROP TABLE finance_expense_clearance_verifications; UPDATE production_metadata SET schema_version=13 WHERE singleton=1; PRAGMA journal_mode=DELETE')
    }
    finally { historical.close() }
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
      expect((await service.form('payment_application', f.native.ids.application, f.session)).draft.paymentVerification).toEqual(before)
      expect(before.proof).toMatchObject({ actorId: f.actor.actorId, workspaceId: f.actor.workspaceId, actualDueAmount: 70, cumulativePayableAmount: 70, basis: f.edit.basis, fileIds: [f.native.ids.applicationFile] })
      const paid = await service.execute(f.payment('pay08-restored-payment'), f.session)
      await recovered.close()
      expect(await service.execute(f.payment('pay08-restored-payment'), f.session)).toEqual(paid)
      expect(await recovered.select('SELECT COUNT(*) AS n,SUM(amount) AS total FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 2, total: 50 }])
      expect(await recovered.select('SELECT COUNT(*) AS n,SUM(amount) AS total FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ n: 1, total: 100 }])
      expect(await recovered.select('SELECT approved_amount,approved_amount_origin FROM payment_applications WHERE id=?', [f.native.ids.application])).toEqual([{ approved_amount: 0, approved_amount_origin: 'legacy' }])
      expect((await service.original('payment_application', f.native.ids.application, f.native.ids.applicationFile, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    }
    finally { await recovered.close() }
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
    await expect(inspectProductionBackup(path)).rejects.toThrow()
    expect(await readFile(path)).toEqual(bytes)
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
