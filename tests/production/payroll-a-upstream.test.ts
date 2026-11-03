import type { BoqCommand } from '../../app/lib/boq/production-contract'
import process from 'node:process'
import { afterAll, expect, it } from 'vitest'
import { payrollCommandRecoveryScope } from '../../app/lib/payroll/command-recovery-scope'
import { collectWorkbookReferences } from '../../server/utils/payroll-workbook-references'
import { readProductionBoqQuantityFacts } from '../../server/utils/production-boq-record'
import { loadProductionPayrollAQuantityFacts } from '../../server/utils/production-payroll-quantity-facts'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { runColdProcess } from '../helpers/cold-process'
import { installProductionBoqFixture } from '../helpers/production-boq-fixture'
import { createPayrollAUpstreamFixture } from '../helpers/production-payroll-a-upstream-fixture'
import { cleanupTestTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('实际施工Main/XLSX原清单→原模板采用命令→班组/完成量，工资源只消费明确资格与现场量', async () => {
  const f = await createPayrollAUpstreamFixture()
  try {
    const source = await f.storage.withTransaction(tx => loadProductionPayrollAQuantityFacts(tx, { projectId: f.project.id, month: '2026-10' }, f.actor))
    expect(source.diagnostics).toEqual([])
    expect(source.rows).toMatchObject([{ fieldQty: 100, crewId: f.crew.id, productionUpstream: { boqLineId: f.boq.line.id, mainContractId: f.boq.main.id, sourceSha256: null } }])
    expect(source.rows[0]!.productionUpstream?.qualificationVersion).toMatch(/^[a-f0-9]{64}$/)
    const unsupported = { ...f.actor, capabilities: f.actor.capabilities.filter(cap => cap !== 'boq:read') }
    await expect(f.storage.withTransaction(tx => loadProductionPayrollAQuantityFacts(tx, { projectId: f.project.id, month: '2026-10' }, unsupported))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  }
  finally { await f.storage.close() }
})

it('真正生产A独立工资价→保存/核算/发放原回执，工资及所选上游稳定引用冻结；零成员不强增个人量', async () => {
  const f = await createPayrollAUpstreamFixture()
  try {
    const owner = createProductionPayrollService(f.storage)
    const service = owner.forSession(f.session)
    const scope = { projectId: f.project.id, crewId: f.crew.id, leaderWorkerId: f.leader.id, month: '2026-10' }
    const config = await service.aConfig({ origin: 'real' }, scope)
    const identity = { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.project.id }
    await service.execute({ ...identity, commandId: 'a-formal-independent-price', sourceVersion: config.context.sourceVersion, statementId: null, draftKey: null, configScope: scope, action: { kind: 'save-a-prices', prices: [{ priceId: null, itemId: f.itemId, unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-10', unitPrice: 10, scope: { kind: 'project' } }] } })
    const draft = { ...scope, memberWorkerIds: [f.leader.id, f.zero.id], payRatio: 1, ratioPlan: { schemaVersion: 1 as const, itemRatios: [{ itemId: f.itemId, ratio: 1 }], feeRatios: [] }, periodKind: 'monthly' as const, book: { bookPurpose: 'ordinary' as const, managementBookId: null }, note: '保原项目实际来源与固定零成员' }
    const form = await service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'a-formal-upstream-book', draft })
    expect(form.blockers).toEqual([])
    expect(form.totals.grossAmount.value).toBe(1000)
    const saved = await service.execute({ ...identity, commandId: 'a-formal-upstream-save', sourceVersion: form.context.sourceVersion, statementId: null, draftKey: form.draftKey, configScope: null, action: { kind: 'save-a-draft', draft } })
    const current = await service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await service.execute({ ...identity, commandId: 'a-formal-upstream-check', sourceVersion: current.context.sourceVersion, statementId: saved.statementId, draftKey: null, configScope: null, action: { kind: 'check-a' } })
    const checked = await service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    const release = { ...identity, commandId: 'a-formal-upstream-original-release', sourceVersion: checked.context.sourceVersion, statementId: saved.statementId, draftKey: null, configScope: null, action: { kind: 'release-a' as const, release: { actualAmount: 1000, allocations: [{ workerId: f.leader.id, amount: 1000 }, { workerId: f.zero.id, amount: 0 }] } } }
    const released = await service.execute(release)
    expect(await service.execute(release)).toEqual(released)
    const output = await service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(output.document?.actualAmount).toBe(1000)
    expect(output.document?.lines[0]!.facts[0]!.productionUpstream).toMatchObject({ boqLineId: f.boq.line.id, mainContractId: f.boq.main.id })
    expect(Object.fromEntries(output.document!.allocations.map(row => [row.workerId, row.amount]))).toEqual({ [f.leader.id]: 1000, [f.zero.id]: 0 })
    const snapshot = await f.storage.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [saved.statementId])
    await f.storage.execute('UPDATE construction_contract_records SET deleted_at=? WHERE id=?', ['2026-10-07T00:00:00.000Z', f.boq.main.id])
    expect((await service.aOutput({ origin: 'real' }, saved.statementId!)).document).toEqual(output.document)
    expect(await f.storage.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [saved.statementId])).toEqual(snapshot)
    const input = { projectId: f.project.id, mode: 'project-month' as const, statementIds: [saved.statementId!], rosterArchiveId: null }
    const preview = await owner.workbook(f.session).workbookPreview({ origin: 'real' }, input)
    const refs = collectWorkbookReferences({ input, groups: preview.groups, issues: preview.issues, rosterRef: preview.rosterRef })
    expect(refs).toEqual(expect.arrayContaining([{ tableName: 'boq_lines', recordId: f.boq.line.id }, { tableName: 'construction_contract_records', recordId: f.boq.main.id }]))
    await f.storage.close()
    const descriptor = { commandId: release.commandId, workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, family: 'payroll', action: release.action.kind, targetId: saved.statementId, scopeId: payrollCommandRecoveryScope(release) }
    const child = await runColdProcess('production-payroll-a-cold', [], { env: { ...process.env, CRM_PAYROLL_A_COLD: JSON.stringify({ options: f.options, actor: f.actor, descriptor, statementId: saved.statementId, projectId: f.project.id }) } })
    const cold = JSON.parse(child.stdout)
    expect(cold.recovered).toEqual({ outcome: 'applied', result: released, command: release })
    expect(cold.output.document).toEqual(output.document)
    expect(cold.netAmount.value).toBe(1000)
    expect(cold.statements[0].snapshot_json).toBe(snapshot[0]!.snapshot_json)
  }
  finally { await f.storage.close() }
})

it('合同已批单价修订与未消费另一Main归档不抬工资源基准；所选Main归档明确阻断', async () => {
  const f = await createPayrollAUpstreamFixture()
  try {
    const query = { projectId: f.project.id, month: '2026-10' }
    const before = await f.storage.withTransaction(tx => loadProductionPayrollAQuantityFacts(tx, query, f.actor))
    const current = await f.boq.owner.read(f.boq.scope, f.session)
    const draft = { projectId: f.project.id, contractId: f.boq.main.id, no: 'A-INDEPENDENT-BOQ-PRICE', name: '合同已批调价', documentType: 'change_negotiation', applicationDate: '2026-10-07', reason: '原合同明确调价，与独立工资报价分开', note: '', lines: [{ id: 'a-upstream-price-line', operation: 'price' as const, boqLineId: f.boq.line.id, deltaQty: null, newUnitPrice: 99 }] }
    const change = (commandId: string, action: 'save' | 'submit' | 'approve', id: string | null, baseVersion: string | null): BoqCommand => ({ workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId, projectId: f.project.id, contractId: f.boq.main.id, origin: 'real', requiredCapability: 'boq:write', contractVersion: current.contractVersion, action: { kind: 'owner-change', command: action === 'approve'
      ? { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId, requiredCapability: 'owner-document:write', kind: 'owner_change', id: id!, baseVersion, action, approvedAt: '2026-10-07' }
      : { workspaceId: f.actor.workspaceId, actorId: f.actor.actorId, commandId, requiredCapability: 'owner-document:write', kind: 'owner_change', id, baseVersion, action, draft, attachments: {} } } })
    const saved = await f.boq.owner.execute(change('a-contract-price-save', 'save', null, null), f.session)
    await f.boq.owner.execute(change('a-contract-price-submit', 'submit', saved.changeId!, '1'), f.session)
    await f.boq.owner.execute(change('a-contract-price-approve', 'approve', saved.changeId!, '2'), f.session)
    const priced = await f.storage.withTransaction(tx => readProductionBoqQuantityFacts(tx, f.project.id, f.actor, { lineIds: [f.boq.line.id] }))
    expect(priced.lines[0]!.effectiveUnitPrice).toBe(99)
    expect(await f.storage.withTransaction(tx => loadProductionPayrollAQuantityFacts(tx, query, f.actor))).toEqual(before)
    const other = await installProductionBoqFixture(f.storage, f.actor, f.project.id, { qty: 88, unitPrice: 999, itemName: '另一主合同未采用分项' })
    await f.storage.execute('UPDATE construction_contract_records SET deleted_at=? WHERE id=?', ['2026-10-07T00:00:00.000Z', other.main.id])
    expect(await f.storage.withTransaction(tx => loadProductionPayrollAQuantityFacts(tx, query, f.actor))).toEqual(before)
    await f.storage.execute('UPDATE construction_contract_records SET deleted_at=? WHERE id=?', ['2026-10-07T00:00:00.000Z', f.boq.main.id])
    const unavailable = await f.storage.withTransaction(tx => loadProductionPayrollAQuantityFacts(tx, query, f.actor))
    expect(unavailable.rows).toEqual([])
    expect(unavailable.diagnostics).toMatchObject([{ code: 'upstream-binding-unavailable', affects: 'subject', crewId: f.crew.id }])
  }
  finally { await f.storage.close() }
})
