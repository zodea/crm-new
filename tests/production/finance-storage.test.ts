import type { FinanceCommand } from '../../app/lib/finance/central-contract'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createPinia, setActivePinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { migrations, runMigrations } from '../../app/lib/db/migrations'
import { FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { createFinanceRepository } from '../../app/lib/finance/http-repository'
import { createFinanceMigrationRepository } from '../../app/lib/finance/migration-repository'
import { paymentApplicationDetailModel } from '../../app/lib/finance/payment-detail-repository'
import { usePaymentManagementStore } from '../../app/stores/payment-management'
import { useProductionAccessStore } from '../../app/stores/production-access'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { copyBackupPackage, createLocalBackup, readBackupPackage, restoreBackupIsolated } from '../../server/utils/production-backup-package'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionConstructionScopeMainFact } from '../../server/utils/production-construction-scope-record'
import { createProductionCustomerService } from '../../server/utils/production-customer-service'
import { readOriginalExpenseReference } from '../../server/utils/production-finance-expense-references'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { readMigrationReference } from '../../server/utils/production-migration-references'
import { createProductionOurSignatoryService } from '../../server/utils/production-our-signatory-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createMemoryDb } from '../helpers/memory-db'

async function fixture() {
  const base = resolve('.tmp/a01-finance-production')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const options = { directory, workspaceId: 'finance-disk-workspace', ownerId: 'finance-disk-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const actor = { workspaceId: options.workspaceId, actorId: options.ownerId, capabilities: ['customer:list:read', 'customer:write', 'project:list:read', 'project:write', 'supplier:list:read', 'supplier:write', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`])] }
  const session = () => structuredClone(actor)
  const baseCommand = { workspaceId: actor.workspaceId, actorId: actor.actorId, baseVersion: null, action: 'save', attachments: {} }
  const customer = await createProductionCustomerService(storage).execute({ ...baseCommand, requiredCapability: 'customer:write', commandId: 'finance-create-customer', draft: { name: '独立合成客户', contact: '合成人' } }, session)
  const project = await createProductionProjectService(storage).execute({ ...baseCommand, requiredCapability: 'project:write', commandId: 'finance-create-project', draft: { name: '独立合成项目', customerId: customer.id, manager: '合成人' } }, session)
  const supplier = await createProductionSupplierService(storage).execute({ ...baseCommand, requiredCapability: 'supplier:write', commandId: 'finance-create-supplier', draft: { name: '独立合成实际分供方', supplierCategory: '其他', contact: '合成人' } }, session)
  const service = createProductionFinanceService(storage)
  const request = (kind: FinanceCommand['kind'], commandId: string, draft: FinanceCommand['draft'], action: FinanceCommand['action'] = 'submit'): FinanceCommand => ({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: `${FINANCE_FAMILIES[kind]}:write`, commandId, kind, baseVersion: null, action, attachments: {}, draft })
  return { storage, options, actor, session, customer, project, supplier, service, request }
}

async function engineering(f: Awaited<ReturnType<typeof fixture>>) {
  f.actor.capabilities.push('our-signatory:read', 'our-signatory:write', 'construction-contract:read', 'construction-contract:write', 'construction-scope:read', 'construction-scope:write')
  const identity = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId }
  const signatory = await createProductionOurSignatoryService(f.storage).execute({ ...identity, commandId: 'finance-real-our-signatory', requiredCapability: 'our-signatory:write', baseVersion: null, draft: { name: '费用实际我方', taxNo: 'FINANCE-REAL-SIGNATORY', registeredAddress: null, legalRepresentative: null, verificationNote: '真实费用工程核验', status: 'active' } }, f.session)
  const head = await createProductionConstructionContractService(f.storage).execute({ ...identity, commandId: 'finance-real-construction-main', requiredCapability: 'construction-contract:write', baseVersion: null, action: 'save', draft: { name: '费用实际施工工程', projectId: f.project.id, customerId: f.customer.id, content: '真实业务费用工程范围', signDate: '2026-10-05', status: '履约中', amount: null, taxRate: 0, ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version }, attachments: {} }, f.session)
  const main = await f.storage.withTransaction(tx => readProductionConstructionScopeMainFact(tx, f.actor, head.id))
  return { id: main.id, projectId: f.project.id, basis: main.basis }
}

async function nativeSource(targetVersion?: number) {
  const native = await createMemoryDb()
  await runMigrations(native, targetVersion ? migrations.filter(migration => migration.version <= targetVersion) : migrations)
  await native.execute('PRAGMA foreign_keys=ON')
  await native.execute('INSERT INTO customers(id,name) VALUES(\'native-customer\',\'旧真实客户\')')
  await native.execute('INSERT INTO projects(id,name,customer_id) VALUES(\'native-project\',\'旧真实项目\',\'native-customer\')')
  await native.execute('INSERT INTO suppliers(id,name) VALUES(\'native-supplier\',\'旧真实个人分供方\')')
  await native.execute(`INSERT INTO current_transactions(id,no,direction,project_id,supplier_id,counterparty,counterparty_name_snapshot,amount,transaction_date,status,note)
    VALUES('native-current','NATIVE-原号','payment','native-project','native-supplier','  旧原文\t','原采用名\n',0.1000001,'2026-07-01','submitted','原说明\n')`)
  await native.execute(`INSERT INTO payment_applications(id,name,biz_type,supplier_id,apply_amount,approved_amount,approved_amount_origin,status)
    VALUES('native-application','旧申请原文','公司付款','native-supplier',100,0,'legacy','submitted')`)
  await native.execute(`INSERT INTO payment_records(id,supplier_id,payee_name,amount,payment_date,voucher_no,bank_serial_no,confirmation_status,confirmed_by,confirmed_at)
    VALUES('native-payment','native-supplier','旧实际收款名',20,'2026-07-02','NATIVE-VOUCHER','NATIVE-BANK','needs_review','','2026-07-02T01:00:00.000Z')`)
  await native.execute(`INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES('native-allocation','native-payment','native-application',20)`)
  await native.execute('UPDATE payment_records SET confirmation_status=\'confirmed\',confirmed_by=\'旧确认人\' WHERE id=\'native-payment\'')
  const audit = { id: 'native-payment', payee_name: '旧实际收款名\t', confirmation_status: 'confirmed', confirmed_by: '旧确认人' }
  await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data,operator) VALUES(?,?,?,?,?,?)', ['native-audit', 'payment_records', 'native-payment', 'legacy-import', JSON.stringify(audit), '原审计人'])
  for (const [id, size, body] of [['native-file', 4, 'AAqA/w=='], ['native-empty', 0, ''], ['native-metadata', 7, null]] as const) {
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?)', [id, 'current_transaction', 'native-current', `${id}.bin`, size, 'application/octet-stream', '原上传人', '2026-07-01T01:00:00.000Z'])
    if (body !== null)
      await native.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES(?,\'base64\',?)', [id, body])
  }
  const bytes = native.raw.export()
  return { native, audit, source: { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') } }
}

it.each([
  ['先款后票', '100', 'after'],
  ['先票后款', '0', 'before'],
  ['无需发票', '0', 'none'],
] as const)('正式 %s 只派生对应待回票义务，差额、批复与现金不被改写', async (invoiceState, pending, key) => {
  const f = await fixture()
  try {
    const app = await f.service.execute(f.request('payment_application', `invoice-obligation-${key}`, { name: '回票义务独立申请', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 100, approvedAmount: null, invoiceState }, 'draft'), f.session)
    const form = await f.service.form('payment_application', app.id, f.session)
    const read = await createFinanceRepository(async () => f.service.paymentDetail(app.id, f.session)).paymentDetail(app.id)
    expect(form.draft).toMatchObject({ applyAmount: 100, invoiceAllocated: 0, invoiceDifference: 100, pendingInvoiceAmount: Number(pending), paidAmount: 0, approvedAmount: null })
    expect(read.detail).toMatchObject({ invoiceState, applyAmount: '100', invoiceDifference: '100', pendingInvoiceAmount: pending, paidAmount: '0', approvedAmount: null, approvedAmountState: 'not-entered' })
    const invalid = structuredClone(read)
    invalid.detail.pendingInvoiceAmount = pending === '0' ? '100' : null
    await expect(createFinanceRepository(async () => invalid).paymentDetail(app.id)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect((await f.storage.withTransaction(tx => tx.select('SELECT apply_amount,invoice_state,approved_amount FROM payment_applications WHERE id=?', [app.id])))).toEqual([{ apply_amount: 100, invoice_state: invoiceState, approved_amount: null }])
  }
  finally { await f.storage.close() }
})

it('正式付款管理沿实际同库清单与详情，现金权限和版本变化不能复用旧金额或借Native补来源', async () => {
  const f = await fixture()
  try {
    const app = await f.service.execute(f.request('payment_application', 'finance-workbench-application', { name: '真实中央已批复申请', status: 'approved', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 100, approvedAmount: 80, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票' }, 'save'), f.session)
    await f.service.execute(f.request('payment_record', 'finance-workbench-payment', { supplierId: f.supplier.id, payeeName: '实际付款对手', amount: 20, paymentDate: '2026-10-05', voucherNo: 'WB-VOUCHER', bankSerialNo: 'WB-BANK', confirmedBy: f.actor.actorId, applicationAllocations: [{ paymentApplicationId: app.id, allocatedAmount: 20 }] }, 'confirm'), f.session)
    let changeVersion = false
    let hold = false
    let entered!: () => void
    let release!: () => void
    const observed = new Promise<void>(resolve => entered = resolve)
    const held = new Promise<void>(resolve => release = resolve)
    const repository = createFinanceRepository(async (url) => {
      if (url.endsWith('/context'))
        return f.service.context('payment_application', f.session)
      if (url.endsWith('/list')) {
        const list = await f.service.list('payment_application', f.session)
        if (hold) {
          entered()
          await held
        }
        if (changeVersion) {
          await f.service.execute(f.request('current', 'finance-workbench-version-change', { direction: 'payment', supplierId: f.supplier.id, amount: 1 }, 'draft'), f.session)
          changeVersion = false
        }
        return list
      }
      if (url.includes('/detail/'))
        return f.service.paymentDetail(app.id, f.session)
      throw new Error('付款管理未登记读取路径')
    })
    vi.stubGlobal('window', {})
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { finance: repository, productionAccess: { status: async () => ({ mode: 'production', authenticated: true, ownerId: f.actor.actorId, purpose: 'verification' }), logout: async () => undefined } } }))
    setActivePinia(createPinia())
    const access = useProductionAccessStore()
    await access.check()
    const store = usePaymentManagementStore()
    await store.load()
    expect(store.snapshotOrigin).toBe('central')
    expect(store.rows).toEqual([expect.objectContaining({ id: app.id, name: '真实中央已批复申请', supplierId: f.supplier.id, workerId: null, paidAmount: 20, dueAmount: 60, paymentStatus: '部分支付' })])
    expect(store.summary).toEqual({ applicationCount: 1, approvedAmount: 80, paidAmount: 20, dueAmount: 60, dueCount: 1 })
    f.actor.capabilities = f.actor.capabilities.filter(cap => cap !== 'finance-payment-record:read')
    await expect(store.load()).rejects.toThrow('实际支付读取权限')
    expect(store.rows).toEqual([])
    expect(store.hasSnapshot).toBe(false)
    expect(store.currentRead).toBe(false)
    f.actor.capabilities.push('finance-payment-record:read')
    changeVersion = true
    await expect(store.load()).rejects.toThrow('事实已变化')
    expect(store.rows).toEqual([])
    await f.storage.close()
    await store.load()
    expect(store.rows[0]).toMatchObject({ paidAmount: 20, dueAmount: 60 })
    hold = true
    const late = store.load()
    await observed
    await access.logout()
    expect(store.rows).toEqual([])
    expect(store.hasSnapshot).toBe(false)
    expect(store.currentRead).toBe(false)
    release()
    await expect(late).rejects.toThrow('身份')
    expect(store.rows).toEqual([])
  }
  finally {
    vi.unstubAllGlobals()
    await f.storage.close()
  }
})

it.each([59, 60])('完整Native v%s字节迁入保稳定ID、原文、历史批复未知、旧审计和所有原件，原键冷恢复不会二次成本或现金', async (version) => {
  const f = await fixture()
  const n = await nativeSource(version)
  try {
    f.actor.capabilities.push('core:migration:write')
    const project = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'projects', f.project.id))
    const supplier = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'suppliers', f.supplier.id))
    const mappings = [{ entityType: 'projects', legacyId: 'native-project', targetId: f.project.id, version: project!.version, sourceVersion: project!.sourceVersion, reason: '逐条核对同一真实项目原始证据' }, { entityType: 'suppliers', legacyId: 'native-supplier', targetId: f.supplier.id, version: supplier!.version, sourceVersion: supplier!.sourceVersion, reason: '逐条核对旧个人临时金对手资料' }]
    const request = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'finance-full-native-import', source: n.source, mappings }
    const repository = createFinanceMigrationRepository(async (url, options) => {
      if (url === '/api/read/finance/import')
        return f.service.migrationState(f.session)
      if (url === '/api/commands/finance/import/preflight')
        return f.service.preflightSnapshot(options?.body, f.session)
      if (url === '/api/commands/finance/import/resolve')
        return f.service.resolveImport(options?.body, f.session)
      if (url === '/api/commands/finance/import')
        return f.service.importSnapshot(options?.body, f.session)
      throw new Error('Unexpected finance migration route')
    })
    expect((await repository.state()).receipts).toEqual([])
    const preview = await repository.preflight(f.actor, n.source)
    expect(preview).toMatchObject({ eligible: true, nativeSchemaVersion: version, sourceBytesSha256: n.source.sha256 })
    expect(preview.references).toEqual(expect.arrayContaining([{ entityType: 'projects', id: 'native-project', label: '旧真实项目' }, { entityType: 'suppliers', id: 'native-supplier', label: '旧真实个人分供方' }]))
    expect(preview.originals).toContainEqual({ fileId: 'native-metadata', fileName: 'native-metadata.bin', fileSize: 7, bodyState: 'metadata-only', ownerId: 'native-current', canDeclareMissingClearance: false })
    const result = await repository.adopt(f.actor, request.commandId, n.source, mappings, [])
    expect(result.records).toEqual(expect.arrayContaining([{ kind: 'current', id: 'native-current', version: '1' }, { kind: 'payment_application', id: 'native-application', version: '1' }, { kind: 'payment_record', id: 'native-payment', version: '1' }]))
    expect((await f.service.form('current', 'native-current', f.session)).draft).toMatchObject({ supplierId: f.supplier.id, projectId: f.project.id, amount: 0.1000001, counterparty: '  旧原文\t', counterpartyNameSnapshot: '原采用名\n', note: '原说明\n' })
    expect((await f.service.form('payment_application', 'native-application', f.session)).draft).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', paidAmount: 20 })
    const detailRepository = createFinanceRepository(async () => f.service.paymentDetail('native-application', f.session))
    const detailRead = await detailRepository.paymentDetail('native-application')
    expect(detailRead.detail).toMatchObject({ approvedAmount: null, approvedAmountState: 'legacy-unknown', paidAmount: '20', unpaidAmount: null, registrationAmount: '80', supplierId: f.supplier.id, workerId: null, contractAmount: null, contractSettledAmount: null, contractPaidAmount: null })
    expect(paymentApplicationDetailModel(detailRead)).toMatchObject({ paidAmount: 20, registrationAmount: 80, unpaidAmount: null, contractAmount: null })
    expect(detailRead.detail.payments).toEqual([expect.objectContaining({ id: 'native-payment', amount: '20', allocatedAmount: '20', confirmationStatus: 'confirmed' })])
    for (const applyAmount of [null, '1e2', 100, 'unknown']) {
      const bad = structuredClone(detailRead)
      Reflect.set(bad.detail, 'applyAmount', applyAmount)
      await expect(createFinanceRepository(async () => bad).paymentDetail('native-application')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    }
    const missingCash = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'finance-payment-record:read' && cap !== 'finance-payment-record:write') })
    const restricted = await createFinanceRepository(async () => f.service.paymentDetail('native-application', missingCash)).paymentDetail('native-application')
    expect(restricted.detail).toMatchObject({ paymentSourceState: 'forbidden', payments: [], canRegisterPayment: false, supplierOtherProjectPaidAmount: null })
    expect(await f.storage.select('SELECT operator,after_data FROM operation_logs WHERE id=\'native-audit\'')).toEqual([{ operator: '原审计人', after_data: JSON.stringify(n.audit) }])
    expect((await f.service.original('current', 'native-current', 'native-file', f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    expect((await f.service.original('current', 'native-current', 'native-empty', f.session)).bytes).toEqual(new Uint8Array())
    await expect(f.service.original('current', 'native-current', 'native-metadata', f.session)).rejects.toThrow('只有元数据')
    expect([...(await validateFinanceJournal(f.storage, f.actor)).metadataOnlyFileIds]).toEqual(['native-metadata'])
    if (version === 59) {
      const staging = join(f.options.directory, 'finance-backup-staging')
      const offline = join(f.options.directory, 'finance-backup-offline')
      const restore = join(f.options.directory, 'finance-backup-restore')
      for (const directory of [staging, offline, restore])
        await mkdir(directory)
      const backup = await createLocalBackup(f.storage, staging, `backup-${randomUUID()}`, () => '2026-10-05T01:00:00.000Z')
      expect(backup.inventory.originals).toEqual({ files: 2, bytes: 4, metadataOnlyFileIds: ['native-metadata'] })
      expect(await readBackupPackage(staging, backup.id)).toEqual(backup)
      expect(await copyBackupPackage(staging, offline, backup.id)).toEqual(backup)
      const recovered = await restoreBackupIsolated(offline, backup.id, restore, 'finance-isolated-read')
      expect(recovered.inventory).toEqual(backup.inventory)
      const restoredStorage = createProductionStorage({ ...f.options, directory: recovered.directory })
      const restoredService = createProductionFinanceService(restoredStorage)
      try {
        expect((await restoredService.form('current', 'native-current', f.session)).attachments.find(file => file.id === 'native-metadata')).toMatchObject({ fileSize: 7, sha256: null })
        await expect(restoredService.original('current', 'native-current', 'native-metadata', f.session)).rejects.toThrow('只有元数据')
        expect((await restoredService.original('current', 'native-current', 'native-file', f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
        await restoredStorage.close()
        expect([...(await validateFinanceJournal(restoredStorage, f.actor)).metadataOnlyFileIds]).toEqual(['native-metadata'])
        expect((await restoredService.paymentDetail('native-application', f.session)).detail.paidAmount).toBe('20')
      }
      finally { await restoredStorage.close() }
      const missingBodyPath = join(f.options.directory, 'finance-missing-existing-body.sqlite')
      await f.storage.backupTo(missingBodyPath)
      const damaged = new DatabaseSync(missingBodyPath)
      damaged.exec('DELETE FROM file_payloads WHERE file_ref_id=\'native-file\'')
      damaged.close()
      await expect(inspectProductionBackup(missingBodyPath)).rejects.toThrow()
    }
    await f.storage.close()
    expect(await f.service.importSnapshot(request, f.session)).toEqual(result)
    expect(await repository.resolve(request.commandId)).toEqual({ outcome: 'applied', result })
    expect((await repository.state()).receipts).toEqual([result])
    expect([...(await validateFinanceJournal(f.storage, f.actor)).metadataOnlyFileIds]).toEqual(['native-metadata'])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 20 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM expense_reimbursement_lines')).toEqual([{ n: 0 }])
    await expect(f.service.importSnapshot({ ...request, mappings: mappings.map(mapping => ({ ...mapping, reason: '换正文' })) }, f.session)).rejects.toThrow('原编号不能修改')
    await expect(f.service.importSnapshot({ ...request, commandId: 'finance-second-import' }, f.session)).rejects.toThrow('已经迁入')
    expect(createHash('sha256').update(n.native.raw.export()).digest('hex')).toBe(n.source.sha256)
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('未应用财务迁入原键封存后冷重开仍阻止迟到采用，完整来源与目标保全', async () => {
  const f = await fixture()
  const n = await nativeSource(59)
  try {
    f.actor.capabilities.push('core:migration:write')
    const commandId = 'finance-import-not-applied'
    expect(await f.service.resolveImport({ commandId }, f.session)).toEqual({ outcome: 'not-applied', commandId })
    await f.storage.close()
    expect(await f.service.resolveImport({ commandId }, f.session)).toEqual({ outcome: 'not-applied', commandId })
    await expect(f.service.importSnapshot({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId, source: n.source, mappings: [] }, f.session)).rejects.toThrow('封存')
    expect((await f.service.migrationState(f.session)).receipts).toEqual([])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM current_transactions')).toEqual([{ n: 0 }])
    expect(createHash('sha256').update(n.native.raw.export()).digest('hex')).toBe(n.source.sha256)
    const other = () => ({ ...f.actor, actorId: 'another-central-actor' })
    await expect(f.service.resolveImport({ commandId }, other)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('完整实际Native五类头、费用明细、开票真实零税和旧文字一起采用，冷开逐实体严格读取及核原费用版本', async () => {
  const f = await fixture()
  const n = await nativeSource(60)
  try {
    f.actor.capabilities.push('core:migration:write')
    await n.native.execute(`INSERT INTO expense_reimbursements(id,applicant,applicant_supplier_id,applicant_name_snapshot,reimbursement_date,status,note) VALUES('native-original-expense','\t原申请人\n','native-supplier','原垫付名称\n','2026-07-01','confirmed','\t原费用说明\n')`)
    await n.native.execute(`INSERT INTO expense_reimbursement_lines(id,reimbursement_id,expense_item,amount,counterparty_supplier_id,counterparty_name_snapshot,note) VALUES('native-original-expense-line','native-original-expense','\t原服务费用\n',17.500001,'native-supplier','原服务名称\n','\t原费用行说明\n')`)
    await n.native.execute(`INSERT INTO invoice_applications(id,name,project_id,amount,tax_rate,tax_amount,application_date,applicant,status,note) VALUES('native-billing','\t原开票申请\n','native-project',80,0,0,'2026-07-01','原开票人','submitted','\t原开票说明\n')`)
    const bytes = n.native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const project = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'projects', f.project.id))
    const supplier = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'suppliers', f.supplier.id))
    const mappings = [{ entityType: 'projects', legacyId: 'native-project', targetId: f.project.id, version: project!.version, sourceVersion: project!.sourceVersion, reason: '实际项目身份与原件核对' }, { entityType: 'suppliers', legacyId: 'native-supplier', targetId: f.supplier.id, version: supplier!.version, sourceVersion: supplier!.sourceVersion, reason: '实际垫付及服务交易方与原件核对' }]
    const adopted = await f.service.importSnapshot({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'finance-all-five-native', source, mappings }, f.session)
    const entities = [['current', 'native-current'], ['reimbursement', 'native-original-expense'], ['payment_application', 'native-application'], ['payment_record', 'native-payment'], ['invoice_application', 'native-billing']] as const
    expect(adopted.records).toEqual(expect.arrayContaining(entities.map(([kind, id]) => ({ kind, id, version: '1' }))))
    await f.storage.close()
    for (const [kind, id] of entities) {
      const read = await createFinanceRepository(async () => f.service.form(kind, id, f.session)).form(kind, id)
      expect(read).toMatchObject({ version: '1', draft: { id }, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, dataOrigin: 'real' })
    }
    expect((await f.service.form('reimbursement', 'native-original-expense', f.session)).draft).toMatchObject({ applicant: '\t原申请人\n', applicantSupplierId: f.supplier.id, applicantNameSnapshot: '原垫付名称\n', note: '\t原费用说明\n', lines: [{ id: 'native-original-expense-line', expenseItem: '\t原服务费用\n', amount: 17.500001, counterpartySupplierId: f.supplier.id, counterpartyNameSnapshot: '原服务名称\n', note: '\t原费用行说明\n' }] })
    expect((await f.service.form('invoice_application', 'native-billing', f.session)).draft).toMatchObject({ name: '\t原开票申请\n', projectId: f.project.id, amount: 80, taxRate: 0, taxAmount: 0, note: '\t原开票说明\n' })
    expect(await f.storage.withTransaction(tx => readOriginalExpenseReference(tx, f.actor, 'native-original-expense-line'))).toMatchObject({ id: 'native-original-expense-line', amount: 17.500001, clearedAmount: 0, version: '1', applicantSupplierId: f.supplier.id, serviceSupplierId: f.supplier.id })
    await validateFinanceJournal(f.storage, f.actor)
    expect(await f.service.resolveImport({ commandId: 'finance-all-five-native' }, f.session)).toEqual({ outcome: 'applied', result: adopted })
    expect(await f.storage.select('SELECT SUM(amount) AS amount FROM expense_reimbursement_lines WHERE original_expense_line_id IS NULL')).toEqual([{ amount: 17.500001 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n,SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 1, amount: 20 }])
    expect(createHash('sha256').update(n.native.raw.export()).digest('hex')).toBe(source.sha256)
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('native保护条件中的字面量大小写改变不能被结构归一掩盖，真实完整SQLite仍拒绝采用', async () => {
  const f = await fixture()
  const n = await nativeSource(59)
  try {
    f.actor.capabilities.push('core:migration:write')
    const guard = (await n.native.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=\'trg_payment_confirmation_balanced\''))[0]!.sql
    await n.native.execute('DROP TRIGGER trg_payment_confirmation_balanced')
    await n.native.execute(guard.replaceAll('\'confirmed\'', '\'CONFIRMED\''))
    const bytes = n.native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    await expect(f.service.preflightSnapshot({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, source }, f.session)).rejects.toThrow('分摊保护结构损坏')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_imports')).toEqual([{ n: 0 }])
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it.each([[59, 'missing'], [59, 'changed'], [60, 'missing'], [60, 'changed']] as const)('完整Native%s原费用冻结触发器%s时预检拒绝，原字节、事实、原件与目标不修写', async (version, damage) => {
  const f = await fixture()
  const n = await nativeSource(version)
  try {
    f.actor.capabilities.push('core:migration:write')
    const guard = (await n.native.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=\'expense_original_reference_insert\''))[0]!.sql
    await n.native.execute('DROP TRIGGER expense_original_reference_insert')
    if (damage === 'changed')
      await n.native.execute(guard.replaceAll('\'confirmed\'', '\'CONFIRMED\''))
    const before = n.native.raw.export()
    const source = { sha256: createHash('sha256').update(before).digest('hex'), payloadBase64: Buffer.from(before).toString('base64') }
    await expect(f.service.preflightSnapshot({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, source }, f.session)).rejects.toThrow('原费用引用与冻结保护结构损坏')
    expect(createHash('sha256').update(n.native.raw.export()).digest('hex')).toBe(source.sha256)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_imports')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM current_transactions')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM file_refs')).toEqual([{ n: 0 }])
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('正式原费guard损坏时journal与备份读取拒绝，不修复原库且冷启动拒绝同一缺口', async () => {
  const f = await fixture()
  let closed = false
  try {
    const saved = await f.service.execute(f.request('current', 'finance-guard-source-record', { direction: 'payment', supplierId: f.supplier.id, amount: 0, transactionDate: '2026-10-05' }, 'draft'), f.session)
    const original = await f.storage.select('SELECT * FROM current_transactions')
    await f.storage.execute('DROP TRIGGER expense_referenced_source_update')
    await expect(validateFinanceJournal(f.storage, f.actor)).rejects.toThrow('原费用引用与冻结保护结构损坏')
    const staging = join(f.options.directory, 'finance-guard-backup')
    await mkdir(staging)
    await expect(createLocalBackup(f.storage, staging, `backup-${randomUUID()}`, () => '2026-10-05T01:00:00.000Z')).rejects.toThrow()
    expect(await f.storage.select('SELECT * FROM current_transactions WHERE id=?', [saved.id])).toEqual(original)
    expect(await f.storage.select('SELECT * FROM sqlite_schema WHERE name=\'expense_referenced_source_update\'')).toEqual([])
    await f.storage.close()
    closed = true
    await expect(f.storage.select('SELECT * FROM current_transactions')).rejects.toThrow()
    const raw = new DatabaseSync(join(f.options.directory, 'ruihang.sqlite'), { readOnly: true })
    try {
      expect(raw.prepare('SELECT * FROM sqlite_schema WHERE name=\'expense_referenced_source_update\'').all()).toEqual([])
      expect(raw.prepare('SELECT * FROM current_transactions').all()).toEqual(original)
    }
    finally { raw.close() }
  }
  finally {
    if (!closed)
      await f.storage.close()
  }
})

it('native原身份字符串与中央相同仍只保历史原键，不能借旧回执授权当前恢复', async () => {
  const f = await fixture()
  const n = await nativeSource()
  try {
    f.actor.capabilities.push('core:migration:write')
    await n.native.execute('CREATE TABLE finance_commands(command_id TEXT PRIMARY KEY,workspace_id TEXT,actor_id TEXT,kind TEXT,request_json TEXT,result_json TEXT)')
    const oldRequest = JSON.stringify({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'native-command-same-strings', kind: 'current', draft: { amount: 0.1000001 } })
    const oldResult = JSON.stringify({ commandId: 'native-command-same-strings', id: 'native-current', version: '7', attachmentIds: ['native-file'] })
    await n.native.execute('INSERT INTO finance_commands VALUES(?,?,?,?,?,?)', ['native-command-same-strings', f.actor.workspaceId, f.actor.actorId, 'current', oldRequest, oldResult])
    const bytes = n.native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const project = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'projects', f.project.id))
    const supplier = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'suppliers', f.supplier.id))
    const mappings = [{ entityType: 'projects', legacyId: 'native-project', targetId: f.project.id, version: project!.version, sourceVersion: project!.sourceVersion, reason: '原证据确认项目' }, { entityType: 'suppliers', legacyId: 'native-supplier', targetId: f.supplier.id, version: supplier!.version, sourceVersion: supplier!.sourceVersion, reason: '原证据确认分供方' }]
    await f.service.importSnapshot({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'finance-isolated-history-import', source, mappings }, f.session)
    const receipt = (await f.storage.select<{ evidence_json: string }>('SELECT evidence_json FROM finance_imports'))[0]!
    expect(JSON.parse(receipt.evidence_json)).toMatchObject({ sourceOrigin: 'native', sourceJournals: { finance_commands: [{ command_id: 'native-command-same-strings', workspace_id: f.actor.workspaceId, actor_id: f.actor.actorId, request_json: oldRequest, result_json: oldResult }] } })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_commands')).toEqual([{ n: 0 }])
    expect(await f.service.resolve('current', 'native-command-same-strings', f.session)).toEqual({ outcome: 'not-applied', commandId: 'native-command-same-strings' })
    await expect(f.service.execute(f.request('current', 'native-command-same-strings', { direction: 'payment', supplierId: f.supplier.id, amount: 1 }), f.session)).rejects.toThrow('封存')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM current_transactions')).toEqual([{ n: 1 }])
    await expect(f.storage.execute('UPDATE finance_imports SET evidence_json=\'{}\'')).rejects.toThrow('immutable')
    await f.storage.execute('UPDATE operation_logs SET operator=\'当前确认者\' WHERE id=\'native-audit\'')
    await expect(validateFinanceJournal(f.storage, f.actor)).rejects.toThrow('证据损坏')
    expect(await n.native.select('SELECT request_json,result_json FROM finance_commands')).toEqual([{ request_json: oldRequest, result_json: oldResult }])
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('错误Native字节、未映射主档、陈旧实际版本与缺外部原件均阻断迁入并保留空目标', async () => {
  const f = await fixture()
  const n = await nativeSource()
  try {
    f.actor.capabilities.push('core:migration:write')
    const base = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId: 'finance-invalid-source-import', source: n.source, mappings: [] }
    await expect(f.service.importSnapshot({ ...base, source: { ...n.source, sha256: '0'.repeat(64) } }, f.session)).rejects.toThrow('实际摘要不一致')
    await expect(f.service.importSnapshot(base, f.session)).rejects.toThrow('未逐项明确映射')
    const project = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'projects', f.project.id))
    const supplier = await f.storage.withTransaction(tx => readMigrationReference(tx, f.actor, 'suppliers', f.supplier.id))
    const mappings = [{ entityType: 'projects', legacyId: 'native-project', targetId: f.project.id, version: project!.version, sourceVersion: project!.sourceVersion, reason: '独立项目确认' }, { entityType: 'suppliers', legacyId: 'native-supplier', targetId: f.supplier.id, version: supplier!.version, sourceVersion: supplier!.sourceVersion, reason: '独立分供方确认' }]
    await expect(f.service.importSnapshot({ ...base, mappings: mappings.map(mapping => ({ ...mapping, version: '999' })) }, f.session)).rejects.toThrow('真实身份或版本已变化')
    await n.native.execute('UPDATE file_refs SET file_path=\'D:/synthetic-original/required.bin\' WHERE id=\'native-metadata\'')
    const bytes = n.native.raw.export()
    const external = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    await expect(f.service.importSnapshot({ ...base, source: external, mappings }, f.session)).rejects.toThrow('须读出原字节')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM current_transactions')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_imports')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM file_refs WHERE owner_type=\'current_transaction\'')).toEqual([{ n: 0 }])
    expect((await n.native.select('SELECT file_path FROM file_refs WHERE id=\'native-metadata\''))).toEqual([{ file_path: 'D:/synthetic-original/required.bin' }])
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('真实完整SQLite中未来未核验版本999不能由通用文件完整性代替财务域授权', async () => {
  const f = await fixture()
  const n = await nativeSource()
  try {
    f.actor.capabilities.push('core:migration:write')
    await n.native.execute('INSERT INTO schema_migrations(version,name) VALUES(999,\'independent-future-unverified\')')
    const bytes = n.native.raw.export()
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const identity = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId }
    await expect(f.service.preflightSnapshot({ ...identity, source }, f.session)).rejects.toThrow('仅支持已核验的 Native 59–60')
    await expect(f.service.importSnapshot({ ...identity, source, commandId: 'finance-future-schema-import', mappings: [] }, f.session)).rejects.toThrow('仅支持已核验的 Native 59–60')
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_imports')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM current_transactions')).toEqual([{ n: 0 }])
    expect((await n.native.select('SELECT MAX(version) AS version FROM schema_migrations'))).toEqual([{ version: 999 }])
    expect(createHash('sha256').update(n.native.raw.export()).digest('hex')).toBe(source.sha256)
  }
  finally {
    n.native.close()
    await f.storage.close()
  }
})

it('真实正式磁盘同费用只计一次，实际现金仅人工确认支付；回执原文冷重开与同键重放不重复写入', async () => {
  const f = await fixture()
  try {
    const constructionMain = await engineering(f)
    const expense = await f.service.execute(f.request('reimbursement', 'finance-original-cost', { projectId: f.project.id, constructionMain, applicantSupplierId: f.supplier.id, reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '已核实独立费用', counterpartySupplierId: f.supplier.id, amount: 40 }] }, 'save'), f.session)
    const source = await f.service.form('reimbursement', expense.id, f.session)
    const clearance = await f.service.execute(f.request('reimbursement', 'finance-clearance', { projectId: f.project.id, applicantSupplierId: f.supplier.id, reimbursementDate: '2026-10-05', lines: [{ expenseItem: '只清偿原垫款', amount: 10, originalExpenseLineId: source.draft.lines[0]!.id }] }), f.session)
    expect((await f.service.form('reimbursement', clearance.id, f.session)).draft.lines).toMatchObject([{ originalExpenseLineId: source.draft.lines[0]!.id, counterpartySupplierId: f.supplier.id }])
    expect(await f.storage.select('SELECT SUM(line.amount) AS amount FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id WHERE head.status=\'confirmed\' AND line.original_expense_line_id IS NULL')).toEqual([{ amount: 40 }])
    const application = await f.service.execute(f.request('payment_application', 'finance-company-application', { name: '真实公司付款申请', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 10, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票' }), f.session)
    const payment = await f.service.execute(f.request('payment_record', 'finance-payment-draft', { supplierId: f.supplier.id, payeeName: '独立合成实际分供方', amount: 10, paymentDate: '2026-10-05', voucherNo: 'SYNTHETIC-VOUCHER', bankSerialNo: 'SYNTHETIC-BANK', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 10 }] }), f.session)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 0 }])
    await validateFinanceJournal(f.storage, f.actor)
    const confirm = { ...f.request('payment_record', 'finance-confirm-payment', { ...(await f.service.form('payment_record', payment.id, f.session)).draft, confirmedBy: '合成财务' }, 'confirm'), id: payment.id, baseVersion: payment.version }
    const confirmed = await f.service.execute(confirm, f.session)
    expect(await f.storage.select('SELECT SUM(amount) AS amount FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ amount: 10 }])
    await f.storage.close()
    expect(await f.service.resolve('payment_record', confirm.commandId, f.session)).toEqual({ outcome: 'applied', result: confirmed })
    expect(await f.service.execute(confirm, f.session)).toEqual(confirmed)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records')).toEqual([{ n: 1 }])
    await f.service.execute({ ...f.request('payment_record', 'finance-unconfirm-payment', { id: payment.id }, 'unconfirm'), id: payment.id, baseVersion: confirmed.version }, f.session)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([{ n: 0 }])
  }
  finally { await f.storage.close() }
})

it('真实正式库原清偿缺金额时额度读取与新清偿明确unavailable，保原事实而不是按SUM零放行', async () => {
  const f = await fixture()
  try {
    const constructionMain = await engineering(f)
    const original = await f.service.execute(f.request('reimbursement', 'finance-sum-original', { projectId: f.project.id, constructionMain, applicantSupplierId: f.supplier.id, reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '实际原费用', counterpartySupplierId: f.supplier.id, amount: 40 }] }, 'save'), f.session)
    const sourceId = (await f.service.form('reimbursement', original.id, f.session)).draft.lines[0]!.id!
    expect(await f.storage.withTransaction(tx => readOriginalExpenseReference(tx, f.actor, sourceId))).toMatchObject({ amount: 40, clearedAmount: 0 })
    const clearance = await f.service.execute(f.request('reimbursement', 'finance-sum-clearance', { projectId: f.project.id, applicantSupplierId: f.supplier.id, reimbursementDate: '2026-10-05', status: 'confirmed', lines: [{ expenseItem: '原清偿', originalExpenseLineId: sourceId, amount: 10 }] }, 'save'), f.session)
    const clearanceId = (await f.service.form('reimbursement', clearance.id, f.session)).draft.lines[0]!.id!
    await f.storage.execute(`UPDATE expense_reimbursement_lines SET amount='unknown' WHERE id=?`, [clearanceId])
    const before = await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')
    await expect(f.storage.withTransaction(tx => readOriginalExpenseReference(tx, f.actor, sourceId))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.service.execute(f.request('reimbursement', 'finance-sum-forbidden-clearance', { projectId: f.project.id, applicantSupplierId: f.supplier.id, reimbursementDate: '2026-10-05', lines: [{ expenseItem: '不能把未知已清偿当零', originalExpenseLineId: sourceId, amount: 40 }] }), f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT * FROM expense_reimbursement_lines ORDER BY id')).toEqual(before)
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records')).toEqual([{ n: 0 }])
    await f.storage.close()
    await expect(f.storage.withTransaction(tx => readOriginalExpenseReference(tx, f.actor, sourceId))).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally { await f.storage.close() }
})

it('实际付款候选及其他项目汇总逐行核实，真实空集与零可读而未知分摊不发布零且冷开保原损坏事实', async () => {
  const f = await fixture()
  try {
    const application = await f.service.execute(f.request('payment_application', 'finance-lookup-paid-source', { name: '实际公司付款', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 100, applyDate: '2026-10-05', applicant: '实际财务', invoiceState: '无需发票' }), f.session)
    const target = await f.service.execute(f.request('payment_application', 'finance-lookup-other-project', { name: '同真实分供方项目预付', bizType: '预付款', projectId: f.project.id, supplierId: f.supplier.id, applyAmount: 40, applyDate: '2026-10-05', applicant: '实际财务', invoiceState: '无需发票' }), f.session)
    const query = { kind: 'payment-applications' as const, supplierId: f.supplier.id, keyword: '' }
    expect((await f.service.lookup('payment_record', query, f.session)).items).toMatchObject([{ id: application.id, hint: expect.stringContaining('已付 ¥0.00') }])
    expect((await f.service.paymentDetail(target.id, f.session)).detail.supplierOtherProjectPaidAmount).toBe('0')
    const zero = await f.service.execute(f.request('payment_application', 'finance-lookup-zero', { name: '真实零草稿', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 0 }, 'draft'), f.session)
    expect((await f.service.lookup('payment_record', query, f.session)).items.find(row => row.id === zero.id)?.hint).toContain('申请 ¥0.00 · 已付 ¥0.00')
    const payment = await f.service.execute(f.request('payment_record', 'finance-lookup-actual-cash', { supplierId: f.supplier.id, payeeName: '实际收款方', amount: 30, paymentDate: '2026-10-05', voucherNo: 'LOOKUP-PAID', bankSerialNo: 'LOOKUP-PAID', confirmedBy: '实际财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] }, 'confirm'), f.session)
    expect((await f.service.lookup('payment_record', query, f.session)).items.find(row => row.id === application.id)?.hint).toContain('已付 ¥30.00')
    expect((await f.service.paymentDetail(target.id, f.session)).detail.supplierOtherProjectPaidAmount).toBe('30')
    const guard = (await f.storage.select<{ sql: string }>('SELECT sql FROM sqlite_schema WHERE name=\'trg_confirmed_payment_allocation_update\''))[0]!.sql
    await f.storage.execute('DROP TRIGGER trg_confirmed_payment_allocation_update')
    await f.storage.execute('UPDATE payment_record_application_allocations SET allocated_amount=\'unknown\' WHERE payment_record_id=?', [payment.id])
    await f.storage.execute(guard)
    const damaged = await f.storage.select('SELECT * FROM payment_record_application_allocations')
    await expect(f.service.lookup('payment_record', query, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.service.paymentDetail(target.id, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.service.form('payment_application', application.id, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const missingCash = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'finance-payment-record:read') })
    expect((await f.service.paymentDetail(target.id, missingCash)).detail).toMatchObject({ supplierOtherProjectPaidAmount: null, payments: [], paymentSourceState: 'forbidden' })
    await f.storage.close()
    await expect(f.service.lookup('payment_record', query, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT * FROM payment_record_application_allocations')).toEqual(damaged)
    expect(await f.storage.select('SELECT amount,confirmation_status FROM payment_records WHERE id=?', [payment.id])).toEqual([{ amount: 30, confirmation_status: 'confirmed' }])
  }
  finally { await f.storage.close() }
})

it('真实正式申请被确认现金采用后拒绝删除，原版本、原件、现金与分摊冻结；撤回原支付后才可删除', async () => {
  const f = await fixture()
  try {
    const request = { ...f.request('payment_application', 'finance-frozen-application', { name: '真实已付原申请', bizType: '公司付款', supplierId: f.supplier.id, applyAmount: 40, applyDate: '2026-10-05', applicant: '实际财务', invoiceState: '无需发票' }), attachments: { add: [{ fileName: '原申请依据.bin', fileSize: 4, payloadBase64: 'AAqA/w==' }] } }
    const application = await f.service.execute(request, f.session)
    const payment = await f.service.execute(f.request('payment_record', 'finance-frozen-application-cash', { supplierId: f.supplier.id, payeeName: '实际收款方', amount: 30, paymentDate: '2026-10-05', voucherNo: 'FROZEN-APP', bankSerialNo: 'FROZEN-APP', confirmedBy: '实际财务', applicationAllocations: [{ paymentApplicationId: application.id, allocatedAmount: 30 }] }, 'confirm'), f.session)
    const original = await f.storage.select('SELECT * FROM payment_record_application_allocations')
    const histories = await f.storage.select('SELECT * FROM finance_history ORDER BY kind,id,version')
    await expect(f.service.execute({ ...f.request('payment_application', 'finance-reject-frozen-delete', { id: application.id }, 'delete'), id: application.id, baseVersion: application.version }, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('不能删除冻结申请') } })
    expect((await f.service.form('payment_application', application.id, f.session)).version).toBe(application.version)
    expect((await f.service.paymentDetail(application.id, f.session)).detail.paidAmount).toBe('30')
    expect(await f.storage.select('SELECT * FROM finance_history ORDER BY kind,id,version')).toEqual(histories)
    expect(await f.storage.select('SELECT * FROM payment_record_application_allocations')).toEqual(original)
    expect((await f.service.original('payment_application', application.id, application.attachmentIds[0]!, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    await f.storage.close()
    expect((await f.service.paymentDetail(application.id, f.session)).detail.paidAmount).toBe('30')
    await f.service.execute({ ...f.request('payment_record', 'finance-withdraw-frozen-app-cash', { id: payment.id }, 'unconfirm'), id: payment.id, baseVersion: payment.version }, f.session)
    await f.service.execute({ ...f.request('payment_application', 'finance-delete-after-withdraw', { id: application.id }, 'delete'), id: application.id, baseVersion: application.version }, f.session)
    expect(await f.storage.select('SELECT confirmation_status,amount FROM payment_records WHERE id=?', [payment.id])).toEqual([{ confirmation_status: 'needs_review', amount: 30 }])
    expect(await f.storage.select('SELECT * FROM payment_record_application_allocations')).toEqual(original)
    expect(await f.storage.select('SELECT file_size FROM file_refs WHERE id=?', [application.attachmentIds[0]!])).toEqual([{ file_size: 4 }])
    await validateFinanceJournal(f.storage, f.actor)
  }
  finally { await f.storage.close() }
})

it('正式冻结历史、原回执与原件逐一独立核验，篡改当前事实、回执或摘要均明确拒绝', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute({ ...f.request('current', 'finance-journal-proof', { direction: 'payment', projectId: f.project.id, supplierId: f.supplier.id, amount: 20, transactionDate: '2026-10-05' }), attachments: { add: [{ fileName: '核验原文.bin', fileSize: 4, payloadBase64: 'AAqA/w==' }] } }, f.session)
    await validateFinanceJournal(f.storage, f.actor)
    await expect(validateFinanceJournal(f.storage, { ...f.actor, actorId: 'other-owner' })).rejects.toThrow('证据损坏')
    await expect(f.storage.execute('UPDATE finance_history SET actor_id=?', ['other-owner'])).rejects.toThrow('immutable')
    await expect(f.storage.execute('DELETE FROM finance_history')).rejects.toThrow('immutable')
    await f.storage.execute('UPDATE current_transactions SET amount=21 WHERE id=?', [saved.id])
    await expect(validateFinanceJournal(f.storage, f.actor)).rejects.toThrow('证据损坏')
    await f.storage.execute('UPDATE current_transactions SET amount=20 WHERE id=?', [saved.id])
    const original = (await f.storage.select<{ result_json: string }>('SELECT result_json FROM finance_commands WHERE command_id=?', ['finance-journal-proof']))[0]!.result_json
    await f.storage.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [JSON.stringify({ ...JSON.parse(original), version: '9' }), 'finance-journal-proof'])
    await expect(validateFinanceJournal(f.storage, f.actor)).rejects.toThrow('证据损坏')
    await f.storage.execute('UPDATE finance_commands SET result_json=? WHERE command_id=?', [original, 'finance-journal-proof'])
    await f.storage.execute('UPDATE file_payloads SET sha256=? WHERE file_ref_id=?', ['0'.repeat(64), saved.attachmentIds[0]!])
    await expect(validateFinanceJournal(f.storage, f.actor)).rejects.toThrow('证据损坏')
    expect(await f.storage.select('SELECT content FROM file_payloads WHERE file_ref_id=?', [saved.attachmentIds[0]!])).toEqual([{ content: new Uint8Array([0, 10, 128, 255]) }])
  }
  finally { await f.storage.close() }
})

it('正式原件真实零字节与高位字节、已删除原件恢复和冷开启保全；错误正文事务回滚并固定原键', async () => {
  const f = await fixture()
  try {
    const request = { ...f.request('current', 'finance-with-originals', { projectId: f.project.id, direction: 'payment', supplierId: f.supplier.id, amount: 20, transactionDate: '2026-10-05' }), attachments: { add: [{ fileName: '合成.bin', fileSize: 4, mimeType: 'application/octet-stream', payloadBase64: 'AAqA/w==' }, { fileName: '合成空.bin', fileSize: 0, payloadBase64: '' }] } }
    const saved = await f.service.execute(request, f.session)
    expect((await f.service.original('current', saved.id, saved.attachmentIds[0]!, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    expect((await f.service.original('current', saved.id, saved.attachmentIds[1]!, f.session)).bytes).toEqual(new Uint8Array())
    const read = await f.service.form('current', saved.id, f.session)
    const deleted = await f.service.execute({ ...f.request('current', 'finance-remove-original', read.draft, 'save'), id: saved.id, baseVersion: saved.version, attachments: { removeIds: [saved.attachmentIds[0]!] } }, f.session)
    await expect(f.service.original('current', saved.id, saved.attachmentIds[0]!, f.session)).rejects.toThrow('已移除')
    await f.service.execute({ ...f.request('current', 'finance-restore-original', read.draft, 'save'), id: saved.id, baseVersion: deleted.version, attachments: { restoreIds: [saved.attachmentIds[0]!] } }, f.session)
    await f.storage.close()
    expect((await f.service.original('current', saved.id, saved.attachmentIds[0]!, f.session)).bytes).toEqual(new Uint8Array([0, 10, 128, 255]))
    const invalid = { ...request, commandId: 'finance-invalid-original', attachments: { add: [{ fileName: '错误.bin', fileSize: 1, payloadBase64: 'AAqA/w==' }] } }
    const before = await f.storage.select('SELECT * FROM current_transactions ORDER BY id')
    await expect(f.service.execute(invalid, f.session)).rejects.toThrow('声明大小')
    expect(await f.storage.select('SELECT * FROM current_transactions ORDER BY id')).toEqual(before)
    await expect(f.service.execute({ ...invalid, attachments: {} }, f.session)).rejects.toThrow('原命令编号')
    expect(await f.service.resolve('current', invalid.commandId, f.session)).toEqual({ outcome: 'not-applied', commandId: invalid.commandId })
    await expect(f.service.execute(invalid, f.session)).rejects.toThrow('封存')
  }
  finally { await f.storage.close() }
})

it('正式版本冲突、跨身份和中途撤权保留原事实；未应用原键封存拦截迟到请求', async () => {
  const f = await fixture()
  try {
    const request = f.request('current', 'finance-version-start', { direction: 'receipt', projectId: f.project.id, supplierId: f.supplier.id, amount: 10, transactionDate: '2026-10-05' })
    const first = await f.service.execute(request, f.session)
    const original = await f.service.form('current', first.id, f.session)
    const edit = { ...request, commandId: 'finance-version-edit', id: first.id, baseVersion: first.version, draft: { ...original.draft, note: '更新说明' } }
    const second = await f.service.execute(edit, f.session)
    await expect(f.service.execute({ ...edit, commandId: 'finance-stale-edit', draft: { ...edit.draft, note: '陈旧说明' } }, f.session)).rejects.toThrow('已更新')
    expect((await f.service.form('current', first.id, f.session)).draft.note).toBe('更新说明')
    await expect(f.service.execute({ ...request, commandId: 'finance-wrong-actor', actorId: 'different-owner' }, f.session)).rejects.toThrow('当前已认证身份')
    let checks = 0
    const revoking = () => ({ ...f.actor, capabilities: ++checks >= 3 ? [] : [...f.actor.capabilities] })
    const before = await f.storage.select('SELECT * FROM current_transactions ORDER BY id')
    await expect(f.service.execute({ ...request, commandId: 'finance-revoked-during-save' }, revoking)).rejects.toThrow('权限')
    expect(await f.storage.select('SELECT * FROM current_transactions ORDER BY id')).toEqual(before)
    expect(await f.service.resolve('current', 'finance-never-arrived', f.session)).toEqual({ outcome: 'not-applied', commandId: 'finance-never-arrived' })
    await f.storage.close()
    await expect(f.service.execute({ ...request, commandId: 'finance-never-arrived' }, f.session)).rejects.toThrow('封存')
    expect((await f.service.form('current', first.id, f.session)).version).toBe(second.version)
  }
  finally { await f.storage.close() }
})

it('正式读取带真实身份、源版本、全局候选与独立读取范围；已知空与无来源不混淆', async () => {
  const f = await fixture()
  try {
    const repository = createFinanceRepository(async (url) => {
      if (url.endsWith('/context'))
        return f.service.context('current', f.session)
      if (url.endsWith('/list'))
        return f.service.list('current', f.session)
      throw new Error('unexpected route')
    })
    const context = await repository.context('current')
    expect(context.meta).toMatchObject({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, dataOrigin: 'real', authorizedScope: { coverage: 'complete' }, sources: expect.arrayContaining([{ key: 'finance', state: 'readable', sourceVersion: 'finance-0', asOf: context.asOf }]) })
    expect(context.scope).toEqual({ kind: 'current', operation: 'context' })
    expect((await repository.list('current')).items).toEqual([])
    const source = await f.service.lookup('current', { kind: 'suppliers', keyword: '' }, f.session)
    expect(source.items).toEqual([{ id: f.supplier.id, label: '独立合成实际分供方', hint: f.supplier.id }])
    expect(source.meta.sources).toContainEqual({ key: 'suppliers', state: 'readable', sourceVersion: 'suppliers-1', asOf: source.asOf })
    await expect(f.service.lookup('current', { kind: 'workers', keyword: '' }, f.session)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    const unavailable = () => ({ ...f.actor, capabilities: [...f.actor.capabilities, 'other-settlement:read'] })
    await expect(f.service.lookup('current', { kind: 'settlements', keyword: '' }, unavailable)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const next = await f.service.execute(f.request('current', 'finance-read-generation', { projectId: f.project.id, direction: 'payment', supplierId: f.supplier.id, amount: 1, transactionDate: '2026-10-05' }), f.session)
    expect((await repository.context('current')).sourceVersion).not.toBe(context.sourceVersion)
    const form = await f.service.form('current', next.id, f.session)
    expect(form.scope).toEqual({ kind: 'current', operation: 'form', id: next.id })
    expect(form.meta.sources.find(row => row.key === 'finance')!.sourceVersion).toBe('finance-1')
    const altered = () => ({ ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'finance-current:read') })
    await expect(f.service.context('current', altered)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await f.storage.close() }
})

it('持久库损坏金额不能经既有Native映射兜底为零，正式读取明确拒绝', async () => {
  const f = await fixture()
  try {
    const saved = await f.service.execute(f.request('current', 'finance-known-zero', { direction: 'payment', supplierId: f.supplier.id, amount: 0 }, 'draft'), f.session)
    expect((await f.service.form('current', saved.id, f.session)).draft.amount).toBe(0)
    await f.storage.execute('UPDATE current_transactions SET amount=? WHERE id=?', ['unknown', saved.id])
    await expect(f.service.form('current', saved.id, f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await expect(f.service.list('current', f.session)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.storage.select('SELECT amount FROM current_transactions WHERE id=?', [saved.id])).toEqual([{ amount: 'unknown' }])
  }
  finally { await f.storage.close() }
})
