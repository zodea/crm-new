import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedPayrollAQuantitySource } from '../helpers/payroll-a-quantity-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

it.each(['deleted-config', 'receipt', 'price-scope', 'price-audit', 'source-fact', 'released-zero', 'unrelated'] as const)('公开迁入后的 A 类独立事实保护危险恢复，重复迁入不动原件：%s', async (kind) => {
  const db = await createMigratedMemoryDb()
  try {
    await seedPayrollAQuantitySource(db)
    const source = await readQuantityCoreSource(db)
    const bytes = db.raw.export()
    const hash = createHash('sha256').update(bytes).digest('hex')
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('a-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('a-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('a-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('a-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'pa-project')!.serverId
    const workerId = batch.mappings.find(row => row.entityType === 'workers' && row.legacyId === 'pa-worker-old')!.serverId
    await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      if (kind === 'deleted-config')
        await tx.execute('INSERT INTO payroll_a_subject_configs(id,project_id,leader_worker_id,initial_pay_ratio,revision,updated_at,deleted_at) VALUES (\'a-config\',?,?,0,1,\'2026-09-13\',\'2026-09-13\')', [projectId, workerId])
      if (kind === 'receipt')
        await tx.execute('INSERT INTO payroll_command_receipts(command_id,actor_id,project_id,config_scope_json,action,fingerprint,result_json) VALUES (\'a-receipt\',\'operator\',\'independent-project\',?,\'configure-a-subject\',\'immutable-request\',\'{"ok":true}\')', [JSON.stringify({ projectId: 'independent-project', month: '2026-08', crewId: null, leaderWorkerId: workerId })])
      if (kind === 'price-scope' || kind === 'price-audit' || kind === 'source-fact' || kind === 'released-zero' || kind === 'unrelated') {
        const facts = await loadPayrollAQuantityFacts(tx, { projectId, month: '2026-08' })
        const fact = facts.rows.find(row => row.workerId === workerId)!
        expect(fact).toBeDefined()
        await tx.execute('INSERT INTO projects(id,name) VALUES (\'independent-project\',\'另一项目\')')
        await tx.execute('INSERT INTO workers(id,name) VALUES (\'independent-worker\',\'另一负责人\')')
        if (kind === 'unrelated') {
          await tx.execute('INSERT INTO payroll_a_subject_configs(id,project_id,leader_worker_id,initial_pay_ratio,revision,updated_at) VALUES (\'independent-config\',\'independent-project\',\'independent-worker\',0,1,\'2026-09-13\')')
        }
        else if (kind === 'price-scope' || kind === 'price-audit') {
          await tx.execute('INSERT INTO items(id,project_id,code,name,trade) VALUES (\'independent-item\',\'independent-project\',\'new\',\'独立分项\',\'油漆工\')')
          await tx.execute('INSERT INTO payroll_a_price_revisions(id,price_id,project_id,leader_worker_id,item_id,unit,mode,effective_month,unit_price,scope_json,revision,operator_id,created_at) VALUES (\'a-price\',\'price\',\'independent-project\',\'independent-worker\',\'independent-item\',\'㎡\',\'baseline\',\'2026-08\',0,?,1,\'operator\',\'2026-09-13\')', [JSON.stringify({ kind: 'cells', cells: [{ unitId: fact.unitId, roomId: fact.roomId, itemId: fact.itemId }] })])
          if (kind === 'price-audit') {
            const [price] = await tx.select('SELECT * FROM payroll_a_price_revisions WHERE id=\'a-price\'')
            await tx.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data) VALUES (\'historical-price\',\'payroll_a_price_revisions\',\'a-price\',\'delete\',?)', [JSON.stringify(price)])
            await tx.execute('DELETE FROM payroll_a_price_revisions WHERE id=\'a-price\'')
          }
        }
        else {
          await tx.execute('INSERT INTO wage_statements(id,project_id,leader_worker_id,month,format_family,quantity_source,status,actual_amount,deleted_at) VALUES (\'independent-statement\',\'independent-project\',\'independent-worker\',\'2026-08\',\'A\',\'field\',?,0,\'2026-09-13\')', [kind === 'released-zero' ? 'released' : 'checked'])
          await tx.execute('INSERT INTO payroll_a_statement_sources(statement_id,project_id,leader_worker_id,source_json) VALUES (\'independent-statement\',\'independent-project\',\'independent-worker\',?)', [JSON.stringify({ schemaVersion: 1, subject: { projectId: 'independent-project', crewId: null, leaderWorkerId: 'independent-worker', memberWorkerIds: kind === 'released-zero' ? [workerId] : [] }, facts: kind === 'released-zero' ? [] : [fact], priceRevisions: [] })])
        }
      }
    })
    const readAll = () => quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
      return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
    })
    const authority = coreMigrationTestInstance.snapshot(session)
    const before = await readAll()
    const repeated = await quantityTestInstance.prepareMigrationSnapshot(authority)
    repeated.commit()
    expect(await readAll()).toEqual(before)
    if (kind === 'unrelated') {
      await coreMigrationTestInstance.rollback({ ...envelope('a-rollback'), batchId: batch.batchId }, session)
      expect((await readAll()).payroll_a_subject_configs).toEqual(before.payroll_a_subject_configs)
      expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
      return
    }
    if (kind === 'price-scope' || kind === 'price-audit' || kind === 'source-fact') {
      const withoutQuantity = { ...authority, entities: authority.entities.filter(row => row.entityType !== 'quantity_projects') }
      await expect(quantityTestInstance.prepareMigrationSnapshot(withoutQuantity)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(await readAll()).toEqual(before)
    }
    await expect(coreMigrationTestInstance.rollback({ ...envelope('a-rollback'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await readAll()).toEqual(before)
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(authority)
  }
  finally { db.close() }
})
