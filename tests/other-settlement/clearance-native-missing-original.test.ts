import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { createHistoricalClearanceMigrationSource } from '../../e2e/helpers/historical-clearance-migration-source'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionOtherSettlementService } from '../../server/utils/production-other-settlement-service'
import { createProductionSupplierService } from '../../server/utils/production-supplier-service'
import { createMemoryDb } from '../helpers/memory-db'
import { createSeededProductionStorage } from '../helpers/production-storage-seed'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

async function fixture(size: number | null, wrongOwner = false) {
  const root = testTempRoot('a02-clearance-tests')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'native-missing-clearance-'))
  const native = await createHistoricalClearanceMigrationSource(join(directory, 'native-source'))
  const db = await createMemoryDb(native.bytes)
  const fileId = 'native-clearance-external-document'
  const originalPath = 'D:\\legacy-ledger\\original-clearance.pdf'
  let source
  try {
    await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,uploader,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)', [fileId, 'expense_reimbursement', wrongOwner ? native.ids.expense : native.ids.clearance, '原清偿外部附件.pdf', originalPath, size, 'application/pdf', '原附件登记人', '2026-10-01T01:00:00.000Z'])
    const bytes = Buffer.from(db.raw.export())
    source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: bytes.toString('base64') }
  }
  finally { db.close() }
  const storage = await createSeededProductionStorage({ directory, workspaceId: 'missing-clearance-workspace', ownerId: 'missing-clearance-owner', purpose: 'verification' })
  const actor = { workspaceId: storage.identity.workspaceId, actorId: storage.identity.actorId, capabilities: ['supplier:list:read', 'supplier:write', 'other-settlement:read', 'other-settlement:write', 'core:migration:write', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`])] }
  const identity = { workspaceId: actor.workspaceId, actorId: actor.actorId }
  const session = () => structuredClone(actor)
  const supplier = createProductionSupplierService(storage)
  const finance = createProductionFinanceService(storage)
  const targets = []
  for (const [legacyId, name] of [[native.ids.service, '原实际运输服务方'], [native.ids.payee, '原实际垫付收款人']]) {
    const row = await supplier.execute({ ...identity, requiredCapability: 'supplier:write', commandId: `missing-original-${legacyId}`, baseVersion: null, action: 'save', attachments: {}, draft: { name, supplierCategory: '其他', contact: '合成核定人' } }, session)
    targets.push({ legacyId: legacyId!, id: row.id })
  }
  const preview = await finance.preflightSnapshot({ ...identity, source }, session)
  const mappings = targets.map((target) => {
    const row = preview.candidates.find(row => row.serverId === target.id)!
    return { entityType: 'suppliers', legacyId: target.legacyId, targetId: target.id, version: row.version, sourceVersion: row.sourceVersion, reason: '实际服务与垫付身份逐项匹配' }
  })
  const request = { ...identity, source, mappings, commandId: 'missing-clearance-exact-import', declaredMissingOriginals: [{ fileId, reason: '此具体旧清偿外部原单已遗失；SQLite原费、清偿及身份关系真实完整，以新签收原账交叉核实' }] }
  return { storage, actor, identity, session, finance, native, preview, request, fileId, originalPath, directory }
}

it.each([12, null])('真实Native仅指定C外部原单缺失size=%s，保原metadata及缺件、替代核定余70并冷备份', async (size) => {
  const f = await fixture(size)
  try {
    expect(f.preview.originals.find(row => row.fileId === f.fileId)).toMatchObject({ canDeclareMissingClearance: true, fileSize: size, bodyState: 'external-required' })
    const imported = await f.finance.importSnapshot(f.request, f.session)
    expect(await f.finance.importSnapshot(f.request, f.session)).toEqual(imported)
    const owner = createProductionOtherSettlementService(f.storage)
    const before = (await owner.expenses(f.session)).items[0]!
    expect(before.clearances[0]).toMatchObject({ missingOriginalDocument: true, originalDocumentState: 'missing-body', declaredMissingOriginals: [{ id: f.fileId, filePath: f.originalPath, fileSize: size }] })
    const form = await f.finance.form('reimbursement', f.native.ids.expense, f.session)
    const added = await f.finance.execute({ ...f.identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', id: f.native.ids.expense, baseVersion: form.version, commandId: 'missing-clearance-alternative-original', action: 'save', attachments: { add: [{ fileName: '真实签收原账交叉核对.bin', fileSize: 4, payloadBase64: 'AAqA/w==', mimeType: 'application/octet-stream' }] }, draft: { id: f.native.ids.expense, clearanceAttachmentsOnly: true } }, f.session)
    const source = (await owner.expenses(f.session)).items[0]!
    await f.finance.execute({ ...f.identity, kind: 'reimbursement', requiredCapability: 'finance-reimbursement:write', id: f.native.ids.expense, baseVersion: added.version, commandId: 'missing-clearance-alternative-verified', action: 'save', attachments: {}, draft: { id: f.native.ids.expense, clearanceVerificationEdit: { originalExpenseLineId: source.id, sourceVersion: source.version, sourceHash: source.clearanceSourceHash, basis: '明确原费用与原清偿身份，原外部原单遗失不改写；以签收、原账交叉核实业务份额而非银行支付', fileIds: added.attachmentIds, items: [{ sourceClearanceLineId: f.native.ids.clearanceLine, amount: 30, matchBasis: '原稳定费用行及清偿行逐项明确采用' }], existingBindings: [] } } }, f.session)
    expect((await owner.expenses(f.session)).items[0]!.qualification).toMatchObject({ state: 'verified', newAdoptableAmount: 70, legacyObligationAmount: 30, legacyPaidAmount: 0, legacyUnpaidAmount: 30 })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM payment_records')).toEqual([{ n: 0 }])
    const physical = await f.storage.select('SELECT file_size,file_path FROM file_refs WHERE id=?', [f.fileId])
    expect(physical).toEqual(size === null ? [] : [{ file_size: size, file_path: f.originalPath }])
    const backup = join(f.directory, 'synthetic-clearance-backup.sqlite')
    const metadata = (await f.storage.select<{ schema_version: number }>('SELECT schema_version FROM production_metadata WHERE singleton=1'))[0]!
    await f.storage.backupTo(backup)
    const inventory = await inspectProductionBackup(backup)
    expect(inventory.schemaVersion).toBe(metadata.schema_version)
    expect(inventory.participants.finance!.tables).toContain('finance_expense_clearance_verifications')
    await f.storage.close()
    expect((await owner.expenses(f.session)).items[0]!.clearances[0]!.declaredMissingOriginals![0]!.fileSize).toBe(size)
  }
  finally { await f.storage.close() }
})

it('原费用E外部原件缺失不能声明成旧清偿缺件，整图原子拒绝而不借M01放宽', async () => {
  const f = await fixture(12, true)
  try {
    expect(f.preview.originals.find(row => row.fileId === f.fileId)?.canDeclareMissingClearance).toBe(false)
    await expect(f.finance.importSnapshot(f.request, f.session)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM expense_reimbursements')).toEqual([{ n: 0 }])
    expect(await f.storage.select('SELECT COUNT(*) AS n FROM finance_imports')).toEqual([{ n: 0 }])
  }
  finally { await f.storage.close() }
})
