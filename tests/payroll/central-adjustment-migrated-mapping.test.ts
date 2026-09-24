import type { PayrollAdjustmentAction, PayrollCorrectionCommand } from '../../app/lib/payroll/central-adjustment-contract'
import { expect, it } from 'vitest'
import { createPayrollMigratedMapper } from '../../server/utils/payroll-migrated-mapping'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

const central = (table: string, value: string) => `migration:fixture:${table}:${encodeURIComponent(value)}`
async function mappingFor(db: { select: <T>(sql: string, params?: unknown[]) => Promise<T[]> }, extras: Array<[string, string]> = []) {
  const entries = new Map<string, { tableName: string, legacyId: string, centralId: string }>()
  const add = (table: string, id: string) => entries.set(JSON.stringify([table, id]), { tableName: table, legacyId: id, centralId: central(table, id) })
  for (const row of await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'')) {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(${row.name})`)
    const pk = row.name === 'payroll_command_receipts' ? 'command_id' : 'id'
    if (!columns.some(c => c.name === pk))
      continue
    for (const value of await db.select<Record<string, unknown>>(`SELECT ${pk} FROM ${row.name}`)) {
      if (typeof value[pk] === 'string')
        add(row.name, value[pk] as string)
    }
  }
  extras.forEach(([table, id]) => add(table, id))
  return [...entries.values()]
}

it('公开发放的 A 类更正：归属、范围与价格完整映射，正文不改，缺身份拒绝', async () => {
  const f = await createPayrollAServiceFixture()
  try {
    const row = f.facts.rows[0]!
    row.ownershipKey = JSON.stringify(['p', row.unitId, row.assignmentId, row.roomId, row.itemId])
    row.fieldQty = 10
    row.fieldFormula = '2*5'
    await f.config()
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 100, scope: { kind: 'cells', cells: [{ unitId: 'u', roomId: 'r', itemId: 'item' }] } }] }))
    const draft = { ...f.draft, payRatio: 1 }
    const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    const statementId = saved.statementId!
    const read = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } }))
    const target = { adjustmentId: null, draftKey: 'mapper-a', originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'A')
      throw new Error('A basis required')
    const correction = { ...initial.draft, reason: '核量有误', evidenceNote: '经办人与负责人复核9平方米', basis: { ...initial.draft.basis, components: initial.draft.basis.components.map(c => ({ ...c, quantity: 9 })) } }
    const form = await f.service.adjustmentForm({ origin: 'real' }, { target, draft: correction })
    const command = (read: typeof form, commandId: string, action: PayrollAdjustmentAction): PayrollCorrectionCommand => ({ commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
    const correctionSaved = await f.service.executeAdjustment(command(form, 'mapper-a-save', { kind: 'save-adjustment-draft', draft: correction }))
    await f.service.executeAdjustment(command(await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: correctionSaved.adjustmentId! } }), 'mapper-a-confirm', { kind: 'confirm-adjustment' }))
    const detail = await f.service.adjustmentDetail({ origin: 'real' }, correctionSaved.adjustmentId!)
    const raw = JSON.stringify(detail)
    const columns = { unitId: 'units', completionId: 'unit_stage_completions', assignmentId: 'unit_assignments', stageId: 'construction_stages', stageItemId: 'construction_stage_items', floorId: 'floors', buildingId: 'buildings', templateId: 'house_type_templates', templateLineId: 'house_type_template_items', roomId: 'rooms', itemId: 'items' } as const
    const mappings = await mappingFor(f.db, [...Object.entries(columns).map(([field, table]) => [table, row[field as keyof typeof columns]] as [string, string]), ['unit_assignment_scopes', 'scope']])
    const mapper = createPayrollMigratedMapper(mappings)
    const mapped = mapper.record(detail.adjustment)
    const basis = mapped.snapshot!.preview.after!
    if (basis.formatFamily !== 'A')
      throw new Error('A mapped basis required')
    const mappedRow = basis.source.facts[0]!
    const oldBasis = detail.adjustment.snapshot!.preview.after!
    if (oldBasis.formatFamily !== 'A')
      throw new Error('A original basis required')
    for (const [field, table] of Object.entries(columns)) expect(mappedRow[field as keyof typeof columns]).toBe(central(table, row[field as keyof typeof columns]))
    expect(mappedRow.ownershipKey).toBe(JSON.stringify([central('projects', 'p'), central('units', 'u'), central('unit_assignments', 'assignment'), central('rooms', 'r'), central('items', 'item')]))
    expect(mappedRow.scopeRows).toEqual([{ id: central('unit_assignment_scopes', 'scope'), roomId: central('rooms', 'r'), itemId: central('items', 'item'), deletedAt: null }])
    expect(mappedRow.assignmentScopeIds).toEqual([central('unit_assignment_scopes', 'scope')])
    expect(mappedRow.crewId).toBeNull()
    expect(mappedRow.sourceFingerprint).toBe(row.sourceFingerprint)
    expect(mappedRow.fieldQty).toBe(10)
    expect(mappedRow.workerName).toBe(row.workerName)
    const oldPrice = oldBasis.source.priceRevisions[0]!
    expect(basis.source.priceRevisions[0]).toMatchObject({ id: central('payroll_a_price_revisions', oldPrice.id), priceId: `migration:fixture:payroll-price:${encodeURIComponent(oldPrice.priceId)}`, operatorId: oldPrice.operatorId, unitPrice: 100, workerId: null, scope: { kind: 'cells', cells: [{ unitId: central('units', 'u'), roomId: central('rooms', 'r'), itemId: central('items', 'item') }] } })
    expect(basis.components[0]).toMatchObject({ ownershipKey: mappedRow.ownershipKey, priceRevisionId: central('payroll_a_price_revisions', oldPrice.id), quantity: 9, unitPrice: 100 })
    expect(mapped.snapshot!.original.provenanceVersion).toBe(detail.original.provenanceVersion)
    expect(mapped.snapshot!.commandId).toBe(central('payroll_command_receipts', 'mapper-a-confirm'))
    expect(mapped.snapshot!.preview.delta).toEqual(detail.adjustment.snapshot!.preview.delta)
    const next = await f.form({ month: '2026-09', payRatio: 1 }, 'mapper-a-next')
    const reconciliation = next.adjustmentReconciliation!
    expect(reconciliation.coverage).toHaveLength(1)
    const nested = mapper.basis({ ...reconciliation.rawBasis, source: { ...reconciliation.rawBasis.source, adjustmentReconciliation: reconciliation } })
    if (nested.formatFamily !== 'A')
      throw new Error('A reconciliation basis required')
    expect(nested.source.adjustmentReconciliation).toMatchObject({ sourceVersion: reconciliation.sourceVersion, actualIdentities: [`real:payroll:released:${central('wage_statements', statementId)}`], coverage: [{ adjustmentId: central('payroll_adjustments', detail.adjustment.id), rootAdjustmentId: central('payroll_adjustments', detail.adjustment.rootAdjustmentId), originalStatementId: central('wage_statements', statementId), ownershipKey: mappedRow.ownershipKey, originalPriceRevisionId: central('payroll_a_price_revisions', oldPrice.id), currentPriceRevisionId: central('payroll_a_price_revisions', oldPrice.id), originalSourceFingerprint: row.sourceFingerprint, currentSourceFingerprint: row.sourceFingerprint }] })
    expect(nested.source.adjustmentReconciliation!.rawBasis.source.facts[0]!.unitId).toBe(central('units', 'u'))
    expect(nested.source.adjustmentReconciliation!.effectiveBasis.components[0]!.quantity).toBe(9)
    expect(JSON.stringify(detail)).toBe(raw)
    expect(() => createPayrollMigratedMapper(mappings.filter(m => m.tableName !== 'rooms')).record(detail.adjustment)).toThrow()
    expect(() => createPayrollMigratedMapper([...mappings, { ...mappings[0]!, centralId: 'conflicting' }])).toThrow()
  }
  finally { await f.close() }
})

it('公开发放的 C1 原依据：逐日与费率身份逐表映射，零值和空配置保留', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    f.source.workers.find(worker => worker.id === 'w')!.dailyWage = 1000
    await f.service.executeC1(f.command(await f.config(), { kind: 'save-c1-rates', rates: [{ workerId: 'w', dailyWage: 1000, overtimeRate: null }, { workerId: 'member', dailyWage: 0, overtimeRate: null }, { workerId: 'zero', dailyWage: 0, overtimeRate: null }] }))
    await f.attendance({ overtimeHours: 0 })
    const saved = await f.service.executeC1(f.command(await f.form(), { kind: 'save-c1-draft', draft: f.draft }))
    const read = () => f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.executeC1(f.command(await read(), { kind: 'check-c1' }))
    await f.service.executeC1(f.command(await read(), { kind: 'release-c1', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
    const form = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: null, draftKey: 'mapper-c1', originalStatementId: saved.statementId! } })
    const originalBasis = form.draft.basis!
    const raw = JSON.stringify(originalBasis)
    const mapper = createPayrollMigratedMapper(await mappingFor(f.db))
    const mapped = mapper.basis(originalBasis)
    if (mapped.formatFamily !== 'C1' || originalBasis.formatFamily !== 'C1')
      throw new Error('C1 basis required')
    expect(mapped.records).toEqual(originalBasis.records.map(row => ({ ...row, recordId: central('attendance_records', row.recordId), workerId: central('workers', row.workerId) })))
    expect(mapped.rates).toEqual(originalBasis.rates.map(rate => ({ ...rate, configId: rate.configId === null ? null : central('payroll_c1_rate_revisions', rate.configId), workerId: central('workers', rate.workerId) })))
    const nullable = structuredClone(originalBasis)
    nullable.rates[0]!.configId = null
    expect(mapper.basis(nullable)).toMatchObject({ rates: [{ configId: null }, { dailyWage: originalBasis.rates[1]!.dailyWage }, { dailyWage: 0 }] })
    expect(mapper.original(form.original)).toMatchObject({ statementId: central('wage_statements', saved.statementId!), originalSignatureAmount: { value: 1000 }, members: form.original.members.map(member => ({ ...member, workerId: central('workers', member.workerId), crewId: member.crewId === null ? null : central('crews', member.crewId) })) })
    expect(JSON.stringify(originalBasis)).toBe(raw)
  }
  finally { await f.close() }
})

it('公开发放的 C2 实际退款再冲销：快照和事实完整映射，指纹及金额不改', async () => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const correction = await f.correct()
    const refund = await f.refund(correction.adjustment.id, 40)
    const target = { kind: 'recording-reversal' as const, draftKey: 'mapper-reverse', original: { kind: 'actual-event' as const, eventId: refund.actualEventId! } }
    const draft = { confirmedNotOccurred: true, confirmedOn: '2026-08-09', evidenceNote: '原退款误点，款项未实际到账' }
    const form = await f.service.actualReversalForm({ origin: 'real' }, { target, draft })
    const result = await f.service.executeAdjustment({ commandId: 'mapper-reverse-command', workspaceId: form.context.workspaceId, actorId: form.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: form.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-recording-reversal', reversal: draft } })
    const detail = await f.service.actualPaymentDetail({ origin: 'real' }, result.actualEventId!)
    const raw = JSON.stringify(detail)
    const mappings = await mappingFor(f.db)
    const mapper = createPayrollMigratedMapper(mappings)
    const fact = mapper.fact(detail.fact)
    const snapshot = mapper.snapshot(detail.snapshot)
    if (!('kind' in snapshot))
      throw new Error('Reversal snapshot required')
    expect(fact).toMatchObject({ identity: `real:payroll:actual:${central('payroll_actual_events', result.actualEventId!)}`, reverses: { kind: 'actual-event', eventId: central('payroll_actual_events', refund.actualEventId!) }, signedAmount: { value: 40 }, sourceVersion: detail.fact.sourceVersion })
    expect(fact.allocations[0]!.proofRefs[0]).toEqual({ ...detail.fact.allocations[0]!.proofRefs[0], id: central('payroll_actual_events', result.actualEventId!) })
    expect(snapshot.originalFact.ref).toEqual({ kind: 'actual-event', eventId: central('payroll_actual_events', refund.actualEventId!) })
    expect(snapshot.applications[0]!.adjustmentId).toBe(central('payroll_adjustments', correction.adjustment.id))
    expect(snapshot.applications[0]!.originalApplicationId).toBe(central('payroll_adjustment_applications', (detail.snapshot as typeof snapshot).applications[0]!.originalApplicationId))
    expect(snapshot.commandId).toBe(central('payroll_command_receipts', 'mapper-reverse-command'))
    expect(JSON.stringify(detail)).toBe(raw)
    expect(() => createPayrollMigratedMapper(mappings.map(m => m.tableName === 'payroll_actual_events' ? { ...m, centralId: null } : m)).fact(detail.fact)).toThrow()
  }
  finally { await f.close() }
})
