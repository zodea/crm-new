import type { PayrollC2Command } from '../../app/lib/payroll/central-c2-contract'
import { afterEach, expect, it } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { importPayrollC2MigrationSource, seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it.each(['disabled', 'null-rate'] as const)('真实迁入%s主体配置保原值，已有confirmed签工仍不能建可发工资', async (kind) => {
  const db = await createMigratedMemoryDb()
  try {
    const { configId } = await seedPayrollC2MigrationSource(db)
    // 仅测试源库重现历史可空字段；新写入接口始终禁止生成缺价配置。
    await db.execute('PRAGMA foreign_keys=OFF')
    await db.execute('CREATE TABLE legacy_config_fixture AS SELECT * FROM payroll_subject_configs')
    await db.execute('DROP TABLE payroll_subject_configs')
    await db.execute('ALTER TABLE legacy_config_fixture RENAME TO payroll_subject_configs')
    await db.execute('UPDATE payroll_subject_configs SET enabled=?,unit_rate=? WHERE id=?', [kind === 'disabled' ? 0 : 1, kind === 'null-rate' ? null : 350.125, configId])
    const imported = await importPayrollC2MigrationSource(db)
    const config = await payrollService.c2Config({ origin: 'real' }, { projectId: imported.projectId, leaderWorkerId: imported.leaderWorkerId })
    const draft = { projectId: imported.projectId, crewId: config.options.workers.find(row => row.id === imported.leaderWorkerId)!.crewId, leaderWorkerId: imported.leaderWorkerId, memberWorkerIds: [imported.leaderWorkerId, imported.workerId], month: '2026-08', note: '' }
    const read = await payrollService.c2Form({ origin: 'real' }, { statementId: null, draftKey: `invalid-${kind}`, draft })
    if (kind === 'disabled') {
      expect(config.config).toMatchObject({ enabled: false, unitRate: 350.125 })
    }
    else {
      expect(config.config).toBeNull()
      expect(config.draft.unitRate).toBeNull()
      expect(config.evidence.flatMap(entry => entry.source.configs)).toContainEqual(expect.objectContaining({ id: configId, unit_rate: null, enabled: 1 }))
    }
    expect(read.facts.some(fact => fact.status === 'confirmed')).toBe(true)
    expect(read.eligibility.canSaveDraft).toBe(false)
    expect(read.blockers).toContainEqual(expect.objectContaining({ code: kind === 'disabled' ? 'config-invalid' : 'config-missing' }))
    const command: PayrollC2Command = { commandId: `invalid-save-${kind}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: imported.projectId, statementId: null, draftKey: read.draftKey, configScope: null, configId: null, action: { kind: 'save-c2-draft', draft } }
    const snapshot = () => quantityTestInstance.withWorkspaceTransaction(async tx => ({ heads: await tx.select('SELECT * FROM wage_statements ORDER BY id'), receipts: await tx.select('SELECT * FROM payroll_command_receipts ORDER BY command_id'), logs: await tx.select('SELECT * FROM operation_logs ORDER BY id'), revision: await tx.select('SELECT * FROM payroll_revision') }))
    const before = await snapshot()
    await expect(payrollService.executeC2(command)).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
    expect((await payrollService.c2Config({ origin: 'real' }, config.scope)).config).toEqual(config.config)
  }
  finally { db.close() }
})
