import type { createMemoryDb } from '../helpers/memory-db'
import { afterEach, describe, expect, it } from 'vitest'
import { LATEST_VERSION } from '~/lib/db/migrations'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { effectiveReceiptAmount } from '~/lib/receipt/effective'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { receiptCommandTestInstance } from '../../server/utils/receipt-command-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const session = resolveBusinessSession()
async function unused(): Promise<never> {
  throw new Error('本例只读取显式 SQLite 来源')
}

function readSource(db: Awaited<ReturnType<typeof createMemoryDb>>) {
  return createCoreMigrationLocalSource({
    isDemoActive: () => false,
    currentSchemaVersion: async () => LATEST_VERSION,
    select: (sql, params) => db.select(sql, params),
    closeDatabase: unused,
    loadProductionSnapshot: unused,
    readSnapshotSource: unused,
    createBackup: unused,
    loadBackup: unused,
    restoreBackup: unused,
    activateMigration: unused,
    clearMigration: unused,
    prepareMigration: unused,
    loadMigrationMarker: unused,
    loadPendingMigrationMarker: unused,
    now: () => '2026-09-11T00:00:00.000Z',
  }).readSource()
}

afterEach(async () => {
  receiptCommandTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

describe('普通收款完整受控迁移', () => {
  it('携施工合同的真实来源经 HTTP 解析保留清单和月度事实，拒绝混入收款字段', async () => {
    const db = await createMigratedMemoryDb()
    try {
      await db.execute(`INSERT INTO customers (id, name) VALUES ('contract-customer-436', '甲方')`)
      await db.execute(`INSERT INTO projects (id, name, customer_id) VALUES ('contract-project-436', '工程', 'contract-customer-436')`)
      await db.execute(`INSERT INTO contracts (id, name, kind, project_id, customer_id, amount) VALUES ('contract-436', '合同', '施工', 'contract-project-436', 'contract-customer-436', 1000)`)
      const source = await readSource(db)
      const request = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId: 'contract-source-http', source, backup: null }
      expect(parseCoreMigrationSourceCommand(request).source).toEqual(source)
      source.entities.construction_contracts[0]!.attributes!.receiptDate = '2026-09-11'
      expect(() => parseCoreMigrationSourceCommand(request)).toThrow(/未知字段/)
    }
    finally {
      db.close()
    }
  })
  it('真实旧库完整迁入；重复确认保留更正，危险回滚保全独立新单、原件与回执', async () => {
    const db = await createMigratedMemoryDb()
    try {
      await db.execute(`INSERT INTO customers (id, name) VALUES ('old-customer-436', '迁入甲方')`)
      await db.execute(`INSERT INTO projects (id, name, customer_id) VALUES ('old-project-436', '迁入项目', 'old-customer-436')`)
      await db.execute(`INSERT INTO receipt_registrations (
        id, no, receipt_date, project_id, customer_id, payer_account, amount, payment_method,
        acceptance_bill_no, bill_due_date, period_no, bank_serial_no, handler, review_status,
        status, note, created_at, updated_at
      ) VALUES ('old-receipt-436', 'SK-MIGRATE-436', '2026-09-10', 'old-project-436', 'old-customer-436',
        '62220001', 12.35, '承兑汇票', 'CD-436', '2026-12-10', '三期', 'BANK-436', '经办甲', '待审核',
        'submitted', '旧库备注', '2026-09-10 01:00:00', '2026-09-10 02:00:00')`)
      await db.execute(`INSERT INTO file_refs (id, owner_type, owner_id, file_name, file_path, file_size,
        mime_type, category, uploader, uploaded_at, deleted_at)
        VALUES ('receipt-file-436', 'receipt_registration', 'old-receipt-436', '收款凭证.txt', 'C:/old.txt',
          6, 'text/plain', 'voucher', '旧经办人', '2026-09-10 01:00:00', NULL)`)
      await db.execute(`INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES ('receipt-file-436', 'base64', '5pS25qy+')`)
      await db.execute(`INSERT INTO receipt_registrations (id, no, receipt_date, project_id, customer_id, amount, status)
        VALUES ('void-receipt-436', 'SK-MIGRATE-VOID', '2026-09-10', 'old-project-436', 'old-customer-436', 98, '已作废')`)
      const source = await readSource(db)
      const old = source.entities.receipt_registrations[0]!
      expect(old).toMatchObject({ amount: '12.35', references: { contractId: null }, attributes: {
        acceptanceBillNo: 'CD-436',
        billDueDate: '2026-12-10',
        periodNo: '三期',
        bankSerialNo: 'BANK-436',
        handler: '经办甲',
      } })
      expect(JSON.parse(String(old.attributes?.attachmentsJson))).toEqual([expect.objectContaining({
        id: 'receipt-file-436',
        ownerId: 'old-receipt-436',
        payloadBase64: '5pS25qy+',
        filePath: 'C:/old.txt',
      })])
      const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
      const hash = 'e'.repeat(64)
      const preflight = parseCoreMigrationSourceCommand({ ...envelope('receipt-preflight'), source, backup: null })
      expect(preflight.source).toEqual(source)
      await coreMigrationTestInstance.preflight(preflight, session)
      const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('receipt-dry'), source, backup: {
        backupId: `core-migration-${source.sourceHash}-${hash}`,
        sourceHash: source.sourceHash,
        sourceVersion: source.sourceVersion,
        snapshotSha256: hash,
        byteLength: 436,
        createdAt: '2026-09-15T00:00:00.000Z',
        immutable: true,
      } }), session)
      await coreMigrationTestInstance.importBatch({ ...envelope('receipt-import'), batchId: batch.batchId }, session)
      expect(receiptCommandTestInstance.facts().rows).toEqual([])
      await coreMigrationTestInstance.confirm({ ...envelope('receipt-confirm'), batchId: batch.batchId }, session)
      const migrated = receiptCommandTestInstance.facts().rows
      const record = migrated.find(row => row.draft.no === 'SK-MIGRATE-436')!
      expect(migrated.find(row => row.draft.no === 'SK-MIGRATE-VOID')?.draft.status).toBe('已作废')
      expect(effectiveReceiptAmount(migrated)).toBe('12.35')
      expect(record).toMatchObject({ draft: { no: 'SK-MIGRATE-436', contractId: null, amount: '12.35', handler: '经办甲' } })
      expect(record.draft.projectId).not.toBe('old-project-436')
      expect(receiptCommandTestInstance.fileContent(record.id, 'receipt-file-436', session)).toMatchObject({ payloadBase64: '5pS25qy+' })
      const save = { workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'receipt:write' as const, origin: 'real' as const, action: 'save' as const, attachments: {}, draft: { ...record.draft, note: '中央更正' } }
      const edited = receiptCommandTestInstance.execute({ ...save, commandId: 'receipt-edit', id: record.id, baseVersion: record.version }, session)
      await coreMigrationTestInstance.confirm({ ...envelope('receipt-confirm-again'), batchId: batch.batchId }, session)
      expect(receiptCommandTestInstance.form(record.id, session).draft.note).toBe('中央更正')
      const independent = receiptCommandTestInstance.execute({ ...save, commandId: 'receipt-new', baseVersion: null, draft: { ...save.draft, bankSerialNo: '' } }, session)
      const beforeRollback = coreMigrationTestInstance.snapshot(session)
      await expect(coreMigrationTestInstance.rollback({ ...envelope('receipt-rollback'), batchId: batch.batchId }, session)).rejects.toThrow(/后来修改|仍引用迁入/)
      expect(coreMigrationTestInstance.snapshot(session)).toEqual(beforeRollback)
      expect(receiptCommandTestInstance.form(record.id, session)).toMatchObject({ version: edited.version, draft: { note: '中央更正' } })
      expect(receiptCommandTestInstance.facts().rows.map(row => row.id)).toContain(independent.id)
      expect(receiptCommandTestInstance.fileContent(record.id, 'receipt-file-436', session).payloadBase64).toBe('5pS25qy+')
      expect(receiptCommandTestInstance.resolve(edited.commandId, session)).toEqual({ outcome: 'applied', result: edited })
    }
    finally {
      db.close()
    }
  })
})
