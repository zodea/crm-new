import { afterEach, expect, it } from 'vitest'
import { PAYROLL_HOLLOW_DEDUCTION_TABLES } from '../../app/lib/payroll/central-hollow-deduction-schema'
import { createReleasedPayrollHollowMigrationFixture, importPayrollHollowFixture } from '../helpers/payroll-hollow-migration-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})

const damagedTable = {
  'policy-zero': 'payroll_hollow_policy_revisions',
  'adoption-missing': 'payroll_hollow_adoptions',
  'start-raw': 'payroll_hollow_starts',
  'release-log': 'operation_logs',
  'quantity-count': 'quantity_hollow_revisions',
} as const
it.each(Object.keys(damagedTable) as Array<keyof typeof damagedTable>)('迁入暖缓存仍每次核原件与完整集合：%s', async (kind) => {
  const f = await createReleasedPayrollHollowMigrationFixture()
  closers.push(f.close)
  expect((await f.service.aOutput({ origin: 'real' }, f.statementId)).state).toBe('available')
  await f.instance.withWorkspaceTransaction(async (tx) => {
    if (kind === 'policy-zero') {
      await tx.execute('UPDATE payroll_hollow_policy_revisions SET unit_amount=0')
    }
    else if (kind === 'adoption-missing') {
      await tx.execute('DELETE FROM payroll_hollow_adoptions')
    }
    else if (kind === 'start-raw') {
      await tx.execute('UPDATE payroll_hollow_starts SET start_json=\'{}\'')
    }
    else if (kind === 'quantity-count') {
      await tx.execute('UPDATE quantity_hollow_revisions SET count=0')
    }
    else {
      const [receipt] = await tx.select<{ result_json: string }>('SELECT result_json FROM payroll_command_receipts WHERE statement_id=? AND action=\'release-a\'', [f.statementId])
      const ids = JSON.parse(receipt!.result_json).logIds as string[]
      const [mapping] = await tx.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence WHERE project_id=?', [f.scope.projectId])
      const map = JSON.parse(mapping!.mapping_json) as Array<{ tableName: string, legacyId: string, centralId: string }>
      const mapped = ids.map(id => map.find(row => row.tableName === 'operation_logs' && row.legacyId === id)!.centralId)
      await tx.execute(`DELETE FROM operation_logs WHERE table_name='wage_statements' AND record_id=? AND id IN (${mapped.map(() => '?').join(',')})`, [f.statementId, ...mapped])
    }
  })
  await expect(f.reloadPayroll().aOutput({ origin: 'real' }, f.statementId)).rejects.toThrow(new RegExp(`^迁入工资 ${damagedTable[kind]}/\\S+ 的原行或证据已缺损，不能继续计算剩余$`))
  const current = await f.instance.exportSnapshotBytes()
  await expect(f.rollback()).rejects.toThrow(kind === 'quantity-count' ? '工程量迁移空鼓原件：迁入原件物理行已改变或缺失' : '工资迁移：迁入后工资或来源已有日常变更；恢复会丢失当前事实，已整批拒绝')
  expect(await f.instance.exportSnapshotBytes()).toEqual(current)
}, 30_000)

it('迁入配置可追加真实0修订，原raw不改；重复迁入保全而恢复拒绝抹掉新修订', async () => {
  const f = await createReleasedPayrollHollowMigrationFixture()
  closers.push(f.close)
  const before = await f.instance.withWorkspaceTransaction(async tx => Object.fromEntries(await Promise.all(PAYROLL_HOLLOW_DEDUCTION_TABLES.map(async table => [table, await tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`)]))))
  const query = { scope: { projectId: f.scope.projectId, crewId: null, leaderWorkerId: f.id('workers', f.original.draft.leaderWorkerId), formatFamily: 'A' as const, book: f.original.draft.book! }, month: '2026-09' }
  const config = await f.service.hollowConfig({ origin: 'real' }, query)
  expect(config.policies[0]?.unitAmount).toBe(30)
  const previous = config.revisions[0]!
  await f.service.executeHollow({ commandId: 'central-hollow-new-zero', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId: f.scope.projectId, target: null, config: query, action: { kind: 'save-hollow-policies', policies: [{ policyId: previous.policyId, baseRevisionId: previous.id, itemId: previous.itemId, enabled: true, unitAmount: 0, effectiveMonth: query.month }] } })
  expect((await f.service.hollowConfig({ origin: 'real' }, query)).policies[0]?.unitAmount).toBe(0)
  const prepared = await f.instance.prepareMigrationSnapshot(f.core.snapshot(f.session))
  prepared.commit()
  expect((await f.reloadPayroll().hollowConfig({ origin: 'real' }, query)).policies[0]?.unitAmount).toBe(0)
  for (const table of PAYROLL_HOLLOW_DEDUCTION_TABLES) {
    const current = await f.instance.withWorkspaceTransaction(tx => tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`))
    for (const row of before[table]!)
      expect(current.find(value => value.id === row.id), table).toEqual(row)
  }
  await expect(f.rollback()).rejects.toThrow('工资迁移：新增 A 类原证据结构不可确认，不能安全撤回来源')
  expect((await f.reloadPayroll().hollowConfig({ origin: 'real' }, query)).policies[0]?.unitAmount).toBe(0)
  const cloned = await cloneQuantityHollowSnapshot(await f.instance.exportSnapshotBytes())
  try {
    const second = await importPayrollHollowFixture(cloned, f.identities)
    closers.push(second.close)
    const nextQuery = { ...query, scope: { ...query.scope, projectId: second.scope.projectId, leaderWorkerId: second.id('workers', query.scope.leaderWorkerId) } }
    expect((await second.service.hollowConfig({ origin: 'real' }, nextQuery)).policies[0]?.unitAmount).toBe(0)
    const output = await second.service.aOutput({ origin: 'real' }, second.id('wage_statements', f.statementId))
    expect(output.state).toBe('available')
    if (output.state !== 'available')
      throw new Error(JSON.stringify(output))
    expect(output.document.actualAmount).toBe(550)
    expect(output.document.hollow?.adoptions[0]?.line.count).toBe(15)
    await second.rollback()
  }
  finally { cloned.close() }
}, 30_000)
