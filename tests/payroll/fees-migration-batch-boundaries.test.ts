import type { CoreMigrationSnapshotDTO, CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import type { PayrollAFeeConfigRead, PayrollAFeesAction } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollIdentitySource } from '../../server/utils/payroll-service'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { PAYROLL_A_FEES_MIGRATION_TABLES } from '../../app/lib/payroll/central-a-fees-schema'
import { QUANTITY_MIGRATION_TABLES } from '../../app/lib/quantity/migration-graph'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance, createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { loadPayrollAManagementScopeFacts } from '../../server/utils/payroll-management-scope-facts'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollService } from '../../server/utils/payroll-service'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'
import { createPayrollFeesMigrationFixture } from '../helpers/payroll-fees-migration-fixture'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

async function secondReleasedSource() {
  const original = await createPayrollAFeesFixture()
  try {
    await original.prices()
    await original.saveFees([original.fee()])
    const draft = { ...original.draft, book: original.ordinary, payRatio: 1 }
    const ordinary = await original.service.execute(original.command(await original.form(draft), { kind: 'save-a-draft', draft }))
    await original.release(ordinary.statementId!, 3730)
    const management = await original.management('2026-09')
    const managed = await management.start()
    const read = await original.service.aForm({ origin: 'real' }, { statementId: managed.statementId! })
    if (!hasPayrollAFeesForm(read))
      throw new Error('第二来源必须是公开读取的真实费用工资')
    const scope = { assignments: management.scope.assignments.map(row => ({ ...row, cells: row.cells.filter(cell => cell.itemId === 'wall') })) }
    await original.service.executeFees(original.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '第二来源真实负价', quantity: 10, unit: '㎡', unitPrice: -2, scope, reason: '第二原责任十平方米', evidenceNote: '独立经办确认原管理清单', actualRef: null }], remove: [] }))
    await original.release(managed.statementId!, 284)
    expect((await original.service.aOutput({ origin: 'real' }, managed.statementId!)).state).toBe('available')
    return { original, source: await readQuantityCoreSource(original.db), bytes: original.db.raw.export() }
  }
  catch (cause) {
    await original.close()
    throw cause
  }
}

async function stage(core: ReturnType<typeof createCoreMigrationTestInstance>, f: Awaited<ReturnType<typeof createPayrollFeesMigrationFixture>>, source: CoreMigrationSourceDTO, bytes: Uint8Array, prefix: string) {
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
  await core.preflight(parseCoreMigrationSourceCommand({ ...f.envelope(`${prefix}-preflight`), source, backup: null }), f.session)
  const batch = await core.dryRun(parseCoreMigrationSourceCommand({ ...f.envelope(`${prefix}-dry`), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), f.session)
  expect(batch.issues.filter(issue => issue.metricKey === 'apply-failed')).toEqual([])
  return batch
}

function identities(snapshot: CoreMigrationSnapshotDTO): PayrollIdentitySource {
  return {
    version: 'real-fees-batch-identities',
    projects: snapshot.entities.filter(e => e.entityType === 'projects').map(e => ({ id: e.id, name: e.name, code: String(e.attributes.code ?? '') })),
    crews: snapshot.entities.filter(e => e.entityType === 'crews').map(e => ({ id: e.id, name: e.name })),
    workers: snapshot.entities.filter(e => e.entityType === 'workers').map(e => ({ id: e.id, name: e.name, crewId: e.references.crewId ?? null })),
  }
}

function service(source: PayrollIdentitySource) {
  return createPayrollService({ session: resolveBusinessSession, identities: () => structuredClone(source), quantityFacts: loadPayrollAQuantityFacts, managementScopeFacts: loadPayrollAManagementScopeFacts, transaction: work => quantityTestInstance.withWorkspaceTransaction(work) })
}

function feeCommand(read: PayrollAFeeConfigRead, commandId: string, action: PayrollAFeesAction) {
  return { commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: read.scope.projectId, statementId: null, draftKey: null, configScope: read.scope, book: read.scope.book, action }
}

function readAll() {
  return quantityTestInstance.withWorkspaceTransaction(async (tx) => {
    const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
    return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select<Record<string, unknown>>(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
  })
}

it('公开第二批及原子边界混合批次均拒绝，两套真实费用原图和当前全状态不变', async () => {
  const first = await createPayrollFeesMigrationFixture()
  const second = await secondReleasedSource()
  try {
    const firstSnapshot = coreMigrationTestInstance.snapshot(first.session)
    const secondBatch = await stage(coreMigrationTestInstance, first, second.source, second.bytes, 'second-public')
    expect(secondBatch.batchId).not.toBe(first.batch.batchId)
    const beforeRejectedImport = await readAll()
    await expect(coreMigrationTestInstance.importBatch({ ...first.envelope('second-public-import'), batchId: secondBatch.batchId }, first.session)).rejects.toMatchObject({ problem: { code: 'conflict', message: '已有另一迁移批次等待确认或回滚' } })
    expect(coreMigrationTestInstance.snapshot(first.session)).toEqual(firstSnapshot)
    expect(await readAll()).toEqual(beforeRejectedImport)

    // UI 和下游 owner 均不允许并存多批次。验证真实边界拒绝，不声称跨批次可迁入：
    // 两份 snapshot 均由各自公开 preflight/import/confirm 生成，不改任何已存 batchId/原件。
    const planner = createCoreMigrationTestInstance()
    const planned = await stage(planner, first, second.source, second.bytes, 'second-isolated')
    await planner.importBatch({ ...first.envelope('second-isolated-import'), batchId: planned.batchId }, first.session)
    await planner.confirm({ ...first.envelope('second-isolated-confirm'), batchId: planned.batchId }, first.session)
    const secondSnapshot = planner.snapshot(first.session)
    const combined = { ...secondSnapshot, entities: [...firstSnapshot.entities, ...secondSnapshot.entities] }
    expect(new Set(combined.entities.map(e => e.id)).size).toBe(combined.entities.length)
    await expect(quantityTestInstance.prepareMigrationSnapshot(combined)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch', message: '工程量迁移：工程量批次或项目引用不唯一' } })
    expect(await readAll()).toEqual(beforeRejectedImport)
    expect(coreMigrationTestInstance.snapshot(first.session)).toEqual(firstSnapshot)
    expect(planner.snapshot(first.session)).toEqual(secondSnapshot)
  }
  finally {
    await first.original.close()
    await second.original.close()
  }
}, 30_000)

it.each(['related', 'unrelated'] as const)('公开rollback区分原生项目真实费用外部引用，六表/回执/无关范围保持：%s', async (kind) => {
  const first = await createPayrollFeesMigrationFixture()
  const native = await createPayrollAFeesFixture()
  try {
    native.source.crews[0]!.name = '独立原生班组'
    await native.config()
    // 只放入独立原生量域的真实父记录；费用仍须在中央库经公开命令生成。
    const parentTables = ['projects', 'crews', 'workers', ...QUANTITY_MIGRATION_TABLES.filter(table => !['file_refs', 'file_payloads', 'operation_logs'].includes(table))]
    await quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      await tx.execute('PRAGMA defer_foreign_keys=ON')
      for (const table of parentTables) {
        for (const row of await native.db.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) {
          // 新增户型的正式触发器已生成整户虚拟行；本例真实细格只引用 fee-room。
          if (table === 'rooms' && row.kind === 'whole_unit')
            continue
          // 关联例先建立真实原生责任，再经公开费用命令引用该待撤人员。
          if (kind === 'related' && table === 'unit_assignments' && row.worker_id === 'w')
            row.worker_id = first.mappedId('workers', 'w')
          const columns = Object.keys(row)
          await tx.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, Object.values(row))
        }
      }
    })
    const source = identities(coreMigrationTestInstance.snapshot(first.session))
    source.projects.push(...native.source.projects)
    source.crews.push(...native.source.crews)
    source.workers.push(...native.source.workers)
    const runtime = service(source)
    const subject = kind === 'related' ? { crewId: first.mappedId('crews', 'crew'), leaderWorkerId: first.mappedId('workers', 'w') } : { crewId: 'crew', leaderWorkerId: 'w' }
    const read = await runtime.aFeeConfig({ origin: 'real' }, { projectId: 'p', ...subject, month: '2026-10', book: native.ordinary })
    expect(read.items.some(item => item.itemId === 'wall')).toBe(true)
    await runtime.executeFees(feeCommand(read, 'unrelated-native-fee-save', { kind: 'save-a-fees', baseVersion: read.baseVersion, fees: [native.fee({ effectiveMonth: '2026-10' })], remove: [] }))
    const before = await readAll()
    const receipt = before.payroll_command_receipts!.find(row => row.command_id === 'unrelated-native-fee-save')!
    expect(receipt).toBeDefined()
    expect(receipt.action).toBe('save-a-fees')
    expect(JSON.parse(String(receipt.command_json))).toMatchObject({ projectId: 'p', configScope: subject })
    expect(before.payroll_a_fee_revisions).toContainEqual(expect.objectContaining({ project_id: 'p', leader_worker_id: subject.leaderWorkerId, crew_id: subject.crewId }))
    const authority = coreMigrationTestInstance.snapshot(first.session)
    const rollback = () => coreMigrationTestInstance.rollback({ ...first.envelope('rollback-preserving-native-fee'), batchId: first.batch.batchId }, first.session)
    if (kind === 'related') {
      // A 入口先扫描费用命令回执；领域前缀不代表引用来自旧 A 业务。
      await expect(rollback()).rejects.toMatchObject({ problem: { code: 'conflict', message: expect.stringContaining(JSON.stringify(['crews', subject.crewId])) } })
      expect(await readAll()).toEqual(before)
      expect(coreMigrationTestInstance.snapshot(first.session)).toEqual(authority)
      return
    }
    const restored = await rollback()
    expect(restored.status).toBe('rolled-back')
    expect(coreMigrationTestInstance.snapshot(first.session).authority).toBe('local')
    const after = await readAll()
    for (const table of PAYROLL_A_FEES_MIGRATION_TABLES)
      expect(after[table]).toEqual(before[table]!.filter(row => row.project_id === 'p'))
    expect(after.payroll_command_receipts).toContainEqual(receipt)
    expect(after.projects).toContainEqual(before.projects!.find(row => row.id === 'p'))
    expect(after.unit_assignments).toContainEqual(before.unit_assignments!.find(row => row.id === 'fee-assignment'))
    const nativeIds = new Set(before.payroll_a_fee_revisions!.filter(row => row.project_id === 'p').map(row => row.id))
    const nativeLogs = before.operation_logs!.filter(row => row.table_name === 'payroll_a_fee_revisions' && nativeIds.has(row.record_id))
    expect(nativeLogs.length).toBeGreaterThan(0)
    expect(after.operation_logs!.filter(row => row.table_name === 'payroll_a_fee_revisions')).toEqual(nativeLogs)
  }
  finally {
    await first.original.close()
    await native.close()
  }
}, 30_000)
