import type { PayrollAAction, PayrollACommand, PayrollACommandRead, PayrollADraft } from '../../app/lib/payroll/central-a-contract'
import type { PayrollHollowCommand, PayrollHollowRead } from '../../app/lib/payroll/central-hollow-deduction-contract'
import type { PayrollIdentitySource } from '../../server/utils/payroll-service'
import { Buffer } from 'node:buffer'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollService } from '../../server/utils/payroll-service'
import { loadQuantityHollowFacts } from '../../server/utils/quantity-hollow-facts'
import { createQuantityHollowFixture } from './quantity-hollow-fixture'

/** 位置/原责任/空鼓/整改/阶段完成/工资全从同库公开命令建立，无健康工资快照种子。 */
export async function createPayrollHollowFixture() {
  const quantity = await createQuantityHollowFixture()
  try {
    quantity.setSession({ ...quantity.session(), capabilities: [...quantity.session().capabilities, 'payroll:read', 'payroll:write'] })
    let read = await quantity.service.hollow(quantity.scope)
    const target = read.data.targets[0]!.target
    await quantity.service.executeHollow(quantity.command(read, { kind: 'create-hollow-inspection', target, input: { inspectedOn: '2026-08-01', count: 19, note: '原户墙砖现场排查19处' } }))
    read = await quantity.service.hollow(quantity.scope)
    const record = read.data.records[0]!
    await quantity.service.executeHollow(quantity.command(read, { kind: 'rectify-hollow-inspection', recordId: record.recordId, expectedRevisionId: record.inspection.revisionId, rectifiedOn: '2026-08-02', count: 4, note: '现场复核已修复4处' }))

    const stage = await quantity.executeQuantity({ kind: 'save-stage', allowArchivedEdit: false, draft: { id: null, code: 'H-COMPLETE', name: '墙砖完成', trade: '泥水工', completionMode: 'unit', sortOrder: 1, itemIds: [target.itemId] } })
    await quantity.executeQuantity({ kind: 'set-reporting-stage', itemId: target.itemId, stageId: stage.id, allowArchivedEdit: false })
    const completionRead = await quantity.quantity.completion(quantity.scope, quantity.session())
    const completion = completionRead.data.stages.find(candidate => candidate.id === stage.id)!
    const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA9sAAAAASUVORK5CYII='
    await quantity.executeQuantity({ kind: 'save-completion', draft: { projectId: quantity.scope.projectId, unitId: target.unitId, stageId: stage.id, status: 'completed', completedAt: '2026-08-01', note: '现场完成验收', expectedCompletionId: completion.completion?.id ?? null, expectedCompletionFingerprint: completion.completion?.fingerprint ?? null, expectedAssignmentId: completion.currentAssignment?.id ?? null, photos: [{ fileName: '完成验收.png', mimeType: 'image/png', fileSize: Buffer.from(contentBase64, 'base64').length, contentBase64 }] } })

    const identities: PayrollIdentitySource = { version: 'hollow-payroll-identities-v1', projects: quantity.projects.map(project => ({ id: project.id, name: project.name, code: project.code })), crews: [], workers: quantity.people.map(person => ({ id: person.id, name: person.name, crewId: null })) }
    const options = { session: quantity.session, identities: () => structuredClone(identities), quantityFacts: loadPayrollAQuantityFacts, hollowFacts: loadQuantityHollowFacts, transaction: <T>(work: (tx: typeof quantity.db, session: ReturnType<typeof quantity.session>) => Promise<T>) => quantity.coordinator.withTransaction(tx => work(tx as typeof quantity.db, quantity.session())) }
    const service = createPayrollService(options)
    let sequence = 0
    const draft: PayrollADraft = { projectId: quantity.scope.projectId, crewId: null, leaderWorkerId: quantity.people[0]!.id, memberWorkerIds: [quantity.people[0]!.id], book: { bookPurpose: 'ordinary', managementBookId: null }, month: '2026-08', periodKind: 'monthly', payRatio: 2 / 3, ratioPlan: { schemaVersion: 1, itemRatios: [{ itemId: target.itemId, ratio: 2 / 3 }], feeRatios: [] }, note: '空鼓与工资独立核验' }
    const command = (current: PayrollACommandRead, action: PayrollAAction): PayrollACommand => ({ commandId: `hollow-wage-${++sequence}`, workspaceId: current.context.workspaceId, actorId: current.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: current.context.sourceVersion, projectId: draft.projectId, statementId: 'statementId' in current ? current.statementId : null, draftKey: 'draftKey' in current ? current.draftKey : null, configScope: 'scope' in current ? current.scope : null, action })
    const config = await service.aConfig({ origin: 'real' }, { projectId: draft.projectId, month: draft.month, crewId: null, leaderWorkerId: draft.leaderWorkerId })
    // 六平方米×250，原比例2/3得累计1000；同时区别空鼓扣款发生在比例之后。
    await service.execute(command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: target.itemId, unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: draft.month, unitPrice: 250, scope: { kind: 'cells', cells: [{ unitId: target.unitId, roomId: target.roomId, itemId: target.itemId }] } }] }))
    const form = (overrides: Partial<PayrollADraft> = {}, draftKey = 'hollow-new-a') => service.aForm({ origin: 'real' }, { statementId: null, draftKey, draft: { ...draft, ...overrides } })
    const startCommand = (current: PayrollHollowRead): PayrollHollowCommand => ({ commandId: `hollow-wage-start-${++sequence}`, workspaceId: current.context.workspaceId, actorId: current.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: current.context.sourceVersion, projectId: draft.projectId, target: current.target, config: null, action: { kind: 'start-hollow-deduction' } })
    return { ...quantity, hollowCommand: quantity.command, quantityService: quantity.service, service, reloadPayroll: () => createPayrollService(options), identities, draft, recordId: record.recordId, target, command, startCommand, form }
  }
  catch (cause) {
    await quantity.close()
    throw cause
  }
}
