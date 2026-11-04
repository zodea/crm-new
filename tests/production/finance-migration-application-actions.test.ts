import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FINANCE_FAMILIES } from '../../app/lib/finance/central-contract'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { testTempRoot } from '../helpers/test-temp-root'

it('旧付款申请迁入后可编辑、重复删除和原号重放，原迁入冻结事实保持不变', { timeout: 60000 }, async () => {
  const native = await createMigratedMemoryDb()
  let bytes: Uint8Array
  try {
    await native.execute(`INSERT INTO payment_applications(id,name,biz_type,apply_amount,invoice_state,note) VALUES('legacy-action-application','旧付款申请','公司付款',30,'无需发票','旧事实')`)
    bytes = native.raw.export()
  }
  finally { native.close() }
  const base = testTempRoot('finance-legacy-action-review')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'synthetic-'))
  const identity = { workspaceId: 'legacy-action-workspace', actorId: 'legacy-action-owner' }
  const storage = createProductionStorage({ directory, workspaceId: identity.workspaceId, ownerId: identity.actorId, purpose: 'verification' })
  const actor = { ...identity, capabilities: ['core:migration:write', 'finance-invoice:read', ...Object.values(FINANCE_FAMILIES).flatMap(family => [`${family}:read`, `${family}:write`])] }
  const session = () => structuredClone(actor)
  try {
    const finance = createProductionFinanceService(storage)
    const source = { sha256: createHash('sha256').update(bytes).digest('hex'), payloadBase64: Buffer.from(bytes).toString('base64') }
    const migration = { ...identity, commandId: 'legacy-action-import', source, mappings: [] }
    const imported = await finance.importSnapshot(migration, session)
    expect(await finance.importSnapshot(migration, session)).toEqual(imported)
    const legacyHistory = await storage.select('SELECT * FROM finance_history WHERE kind=? AND id=? AND version=1', ['payment_application', 'legacy-action-application'])
    const legacyReceipt = await storage.select('SELECT * FROM finance_imports WHERE command_id=?', [migration.commandId])
    expect(legacyHistory).toHaveLength(1)
    expect(legacyReceipt).toHaveLength(1)
    const form = await finance.form('payment_application', 'legacy-action-application', session)
    const edit = { ...identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application' as const, action: 'draft' as const, commandId: 'legacy-action-edit', id: 'legacy-action-application', baseVersion: form.version, attachments: {}, draft: { ...form.draft, note: '迁入后人工补充' } }
    const edited = await finance.execute(edit, session)
    expect(await finance.execute(edit, session)).toEqual(edited)
    expect((await finance.form('payment_application', edit.id, session)).draft.note).toBe('迁入后人工补充')
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
    const remove = { ...edit, action: 'delete' as const, commandId: 'legacy-action-delete', baseVersion: edited.version, draft: {} }
    const deleted = await finance.execute(remove, session)
    expect(await finance.execute(remove, session)).toEqual(deleted)
    const removeAgain = { ...remove, commandId: 'legacy-action-delete-again', baseVersion: deleted.version }
    const repeated = await finance.execute(removeAgain, session)
    expect(await finance.execute(removeAgain, session)).toEqual(repeated)
    expect(repeated.logId).toBeNull()
    const history = await storage.select<{ version: number, snapshot_json: string }>('SELECT version,snapshot_json FROM finance_history WHERE kind=? AND id=? ORDER BY version', ['payment_application', edit.id])
    expect(history.map(row => row.version)).toEqual([1, 2, 3, 4])
    expect(JSON.parse(history[1]!.snapshot_json).head.note).toBe('迁入后人工补充')
    const firstDelete = JSON.parse(history[2]!.snapshot_json).head.deleted_at
    expect(typeof firstDelete).toBe('string')
    expect(JSON.parse(history[3]!.snapshot_json).head.deleted_at).toBe(firstDelete)
    expect(await storage.select('SELECT * FROM finance_history WHERE kind=? AND id=? AND version=1', ['payment_application', edit.id])).toEqual(legacyHistory)
    expect(await storage.select('SELECT * FROM finance_imports WHERE command_id=?', [migration.commandId])).toEqual(legacyReceipt)
    expect(await finance.importSnapshot(migration, session)).toEqual(imported)
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
  }
  finally { await storage.close() }
})
