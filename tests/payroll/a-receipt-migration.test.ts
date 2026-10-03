import type { PayrollACommand } from '../../app/lib/payroll/central-a-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { payrollACanonical } from '../../app/lib/payroll/central-a-calculation'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

async function importedSource() {
  const db = await createMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    const hash = createHash('sha256').update(bytes).digest('hex')
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('receipt-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('receipt-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('receipt-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('receipt-confirm'), batchId: batch.batchId }, session)
    return {
      batch,
      projectId: batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'pa-project')!.serverId,
      workerId: batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'pa-worker-other')!.serverId,
      crewId: batch.mappings.find(row => row.entityType === 'crews' && row.legacyId === 'pa-crew-current')!.serverId,
    }
  }
  finally { db.close() }
}

function readAll() {
  return quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
  })
}

it.each(['source-only', 'invalid-json', 'unknown-field', 'mismatched-fingerprint', 'legacy-null', 'unrelated-subject'] as const)('真实命令回执保护恢复，坏正文阻断而旧缺正文不补造：%s', async (kind) => {
  const { batch, projectId, workerId, crewId } = await importedSource()
  const read = await payrollService.aConfig({ origin: 'real' }, { projectId, leaderWorkerId: workerId, crewId, month: '2026-08' })
  const fact = await quantityTestInstance.withWorkspaceTransaction(async tx => (await loadPayrollAQuantityFacts(tx, { projectId, month: '2026-08' })).rows.find(row => row.workerId === workerId)!)
  expect(fact.fieldQty).toBe(4)
  const command: PayrollACommand = { commandId: 'price-command', workspaceId: read.context.workspaceId, actorId: read.context.actorId, requiredCapability: 'payroll:write', origin: 'real', sourceVersion: read.context.sourceVersion, projectId, statementId: null, draftKey: null, configScope: read.scope, action: { kind: 'save-a-prices', prices: [{ priceId: null, itemId: fact.itemId, unit: fact.unit, mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 10, scope: { kind: 'cells', cells: [{ unitId: fact.unitId, roomId: fact.roomId, itemId: fact.itemId }] } }] } }
  if (kind === 'unrelated-subject')
    command.action = { kind: 'save-a-subject-config', config: { leaderWorkerId: workerId, crewId, initialPayRatio: 0 } }
  const saved = await payrollService.execute(command)
  expect(saved.outcome).toBe('saved')
  expect(saved.priceRevisionIds).toHaveLength(kind === 'unrelated-subject' ? 0 : 1)
  await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const [receipt] = await tx.select<{ command_json: string }>('SELECT command_json FROM payroll_command_receipts WHERE command_id=?', [command.commandId])
    expect(JSON.parse(receipt!.command_json)).toEqual(command)
    // 隔离库复现旧事实缺行；不提供或放松任何正式删除价格/审计的命令。
    await tx.execute('DELETE FROM operation_logs WHERE table_name=\'payroll_a_price_revisions\'')
    await tx.execute('DELETE FROM payroll_a_price_revisions')
    if (kind === 'invalid-json')
      await tx.execute('UPDATE payroll_command_receipts SET command_json=\'{\' WHERE command_id=?', [command.commandId])
    if (kind === 'unknown-field') {
      const raw = payrollACanonical({ ...command, action: { ...command.action, unrecognizedReferences: [{ workerId }] } })
      await tx.execute('UPDATE payroll_command_receipts SET command_json=?,fingerprint=? WHERE command_id=?', [raw, createHash('sha256').update(raw).digest('hex'), command.commandId])
    }
    if (kind === 'mismatched-fingerprint')
      await tx.execute('UPDATE payroll_command_receipts SET fingerprint=\'unproved\' WHERE command_id=?', [command.commandId])
    if (kind === 'legacy-null')
      await tx.execute('UPDATE payroll_command_receipts SET command_json=NULL WHERE command_id=?', [command.commandId])
  })
  const authority = coreMigrationTestInstance.snapshot(session)
  const before = await readAll()
  const repeat = await quantityTestInstance.prepareMigrationSnapshot(authority)
  repeat.commit()
  expect(await readAll()).toEqual(before)
  const withdrawQuantity = async () => {
    const prepared = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(row => row.entityType !== 'quantity_projects') })
    await prepared.abort()
  }
  if (kind === 'legacy-null' || kind === 'unrelated-subject') {
    await expect(withdrawQuantity()).resolves.toBeUndefined()
    // 量图无已证明引用时不误挡，但原列仍指向项目/负责人，不能整批撤销。
    await expect(coreMigrationTestInstance.rollback({ ...envelope('receipt-rollback'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  }
  else {
    await expect(withdrawQuantity()).rejects.toMatchObject({ problem: { code: 'conflict' } })
  }
  expect(await readAll()).toEqual(before)
  expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
})
