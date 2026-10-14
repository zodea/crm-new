import { expect, it } from 'vitest'
import { parsePayrollProjectGraph, readPayrollProjectMigrationGraphs } from '../../app/lib/migration/payroll-source'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

it('完整工资来源保P7原计划、准备执行与原命令，未知JSON扩展逐字保留且不复制现金', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.attendance()
    const saved = await f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))
    await f.service.executeC1(f.command(await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! }), { kind: 'check-c1' }))
    const preview = await f.service.batchPreview({ origin: 'real' }, { purpose: 'release', projectId: 'p', month: '2026-08', statementIds: [saved.statementId!], fundingAmountFen: 60125 })
    const plan = await f.service.executeBatch({ schemaVersion: 1, commandId: 'original-p7-confirm', workspaceId: 'work', actorId: 'actor', origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: 'p', month: '2026-08', previewVersion: preview.previewVersion, fundingAmountFen: 60125, items: [{ ...preview.items[0]!.target, decision: { kind: 'release', actualAmountFen: 60125, allocations: preview.items[0]!.members.map((member, index) => ({ workerId: member.workerId, amountFen: index ? 0 : 60125 })) } }] } } })
    const prepared = await f.service.executeBatch({ schemaVersion: 1, commandId: 'original-p7-prepare', workspaceId: 'work', actorId: 'actor', origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'prepare-batch-item', input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId: 'original-p7-execute' } } })
    const [attempt] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts WHERE plan_id=?', [plan.planId])
    const unknown = JSON.stringify({ diagnosis: '原计划备注保全', unknownExtension: { future: ['opaque-id', 0, null] } })
    await f.db.execute('UPDATE payroll_batch_attempts SET problem_json=? WHERE id=?', [unknown, attempt!.id])
    const first = await readPayrollProjectMigrationGraphs(f.db)
    const source = parsePayrollProjectGraph(JSON.parse(String(first.find(row => row.legacyId === 'p')!.attributes.payrollGraphJson)))
    expect(source.schemaVersion).toBe(7)
    expect(source.coordination?.tables.payroll_batch_plans).toEqual(await f.db.select('SELECT * FROM payroll_batch_plans WHERE project_id=?', ['p']))
    expect(source.coordination?.tables.payroll_batch_attempts[0]).toMatchObject({ command_json: attempt!.command_json, problem_json: unknown, execute_command_id: 'original-p7-execute', state: 'prepared' })
    expect((await f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })).status).toBe('checked')
    expect(source.central?.tables.payroll_actual_events ?? []).toEqual([])
    expect(await readPayrollProjectMigrationGraphs(f.db)).toEqual(first)
    expect(prepared.preparedExecuteCommandId).toBe('original-p7-execute')
    const unsafe = structuredClone(source)
    unsafe.coordination!.tables.payroll_batch_attempts[0]!.plan_id = 'missing-original-plan'
    expect(() => parsePayrollProjectGraph(unsafe)).toThrow('P7')
  }
  finally { await f.close() }
})
