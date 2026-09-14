import type { PayrollAAdjustmentCoverage, PayrollAAdjustmentReconciliation } from '../../app/lib/payroll/central-a-adjustment-contract'
import type { PayrollABlocker, PayrollAFrozenDocument, PayrollALine, PayrollAPriceRevision, PayrollAQuantityFact, PayrollAStatementSourceSnapshot } from '../../app/lib/payroll/central-a-contract'
import type { PayrollActualFact, PayrollActualPaymentSnapshot, PayrollActualRef, PayrollActualReversalSnapshot, PayrollProofRef } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollAAdjustmentBasis, PayrollAdjustmentBasisDraft, PayrollAdjustmentConfirmedSnapshot, PayrollAdjustmentRecord, PayrollOriginalWageRef } from '../../app/lib/payroll/central-adjustment-contract'
import type { PayrollC1FrozenDocument } from '../../app/lib/payroll/central-c1-contract'
import type { PayrollC2FrozenDocument, PayrollC2OutputDocument, PayrollC2OutputIdentity } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollIdentityMapping, PayrollSourceDiagnostic } from '../../app/lib/payroll/central-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import { payrollProblem } from '../../app/lib/payroll/central-contract'

const key = (table: string, id: string) => JSON.stringify([table, id])
const ownershipTables = ['projects', 'units', 'unit_assignments', 'rooms', 'items'] as const

/** 原正文先在来源身份空间证明；此处仅构造消费端 DTO，不改 JSON、hash 或源版本。 */
export function createPayrollMigratedMapper(mapping: PayrollIdentityMapping[]) {
  const identities = new Map<string, string | null>()
  function invalid(message: string): never {
    throw payrollProblem('unavailable', `迁入工资身份映射不可用：${message}`)
  }
  for (const row of mapping) {
    if (typeof row.tableName !== 'string' || !row.tableName || typeof row.legacyId !== 'string' || !row.legacyId || (row.centralId !== null && (typeof row.centralId !== 'string' || !row.centralId)))
      invalid('映射行缺少身份')
    const identity = key(row.tableName, row.legacyId)
    if (identities.has(identity) && identities.get(identity) !== row.centralId)
      invalid('同一原身份有冲突目标')
    identities.set(identity, row.centralId)
  }
  function id(table: string, value: string): string {
    const mapped = identities.get(key(table, value))
    if (!mapped)
      invalid(`${table}/${value} 缺少明确目标`)
    return mapped
  }
  function nullableId(table: string, value: string | null): string | null {
    return value === null ? null : id(table, value)
  }
  function ownership(value: string): string {
    let parts: unknown
    try {
      parts = JSON.parse(value)
    }
    catch { return invalid('工程量归属键不是五段身份') }
    if (!Array.isArray(parts) || parts.length !== ownershipTables.length || parts.some(part => typeof part !== 'string' || !part) || JSON.stringify(parts) !== value)
      invalid('工程量归属键不是明确的项目、部位、任务、房间、分项')
    return JSON.stringify(ownershipTables.map((table, index) => id(table, parts[index] as string)))
  }
  function actualRef(value: PayrollActualRef): PayrollActualRef {
    return value.kind === 'released-statement'
      ? { kind: value.kind, statementId: id('wage_statements', value.statementId) }
      : { kind: value.kind, eventId: id('payroll_actual_events', value.eventId) }
  }
  function actualIdentity(value: string): string {
    for (const [prefix, table] of [['real:payroll:released:', 'wage_statements'], ['real:payroll:actual:', 'payroll_actual_events']] as const) {
      if (value.startsWith(prefix))
        return `${prefix}${id(table, value.slice(prefix.length))}`
    }
    return invalid('实际收付身份种类无法确认')
  }
  function proof(value: PayrollProofRef): PayrollProofRef {
    const tables = { 'frozen-source': 'wage_statements', 'adjustment-confirmation': 'payroll_adjustments', 'actual-confirmation': 'payroll_actual_events' } as const
    return { ...value, id: id(tables[value.kind], value.id) }
  }
  function original(value: PayrollOriginalWageRef): PayrollOriginalWageRef {
    return {
      ...value,
      statementId: id('wage_statements', value.statementId),
      projectId: id('projects', value.projectId),
      crewId: nullableId('crews', value.crewId),
      leaderWorkerId: id('workers', value.leaderWorkerId),
      memberWorkerIds: value.memberWorkerIds.map(value => id('workers', value)),
      members: value.members.map(member => ({ ...member, workerId: id('workers', member.workerId), crewId: nullableId('crews', member.crewId) })),
    }
  }
  function quantity(value: PayrollAQuantityFact): PayrollAQuantityFact {
    return {
      ...value,
      ownershipKey: ownership(value.ownershipKey),
      completionId: id('unit_stage_completions', value.completionId),
      assignmentId: id('unit_assignments', value.assignmentId),
      stageId: id('construction_stages', value.stageId),
      stageItemId: id('construction_stage_items', value.stageItemId),
      unitId: id('units', value.unitId),
      floorId: id('floors', value.floorId),
      buildingId: id('buildings', value.buildingId),
      templateId: id('house_type_templates', value.templateId),
      templateLineId: id('house_type_template_items', value.templateLineId),
      roomId: id('rooms', value.roomId),
      itemId: id('items', value.itemId),
      workerId: nullableId('workers', value.workerId),
      crewId: nullableId('crews', value.crewId),
      assignmentScopeIds: value.assignmentScopeIds.map(value => id('unit_assignment_scopes', value)),
      scopeRows: value.scopeRows.map(row => ({ ...row, id: id('unit_assignment_scopes', row.id), roomId: id('rooms', row.roomId), itemId: id('items', row.itemId) })),
    }
  }
  function price(value: PayrollAPriceRevision): PayrollAPriceRevision {
    const revisionId = id('payroll_a_price_revisions', value.id)
    const suffix = `:payroll_a_price_revisions:${encodeURIComponent(value.id)}`
    if (!revisionId.endsWith(suffix) || revisionId.length === suffix.length)
      invalid('价格修订不属于明确迁入命名空间')
    const entityId = revisionId.slice(0, -suffix.length)
    return {
      ...value,
      id: revisionId,
      // 系列身份没有独立表；与运输层的 price_id 命名空间完全一致。
      priceId: `${entityId}:payroll-price:${encodeURIComponent(value.priceId)}`,
      projectId: id('projects', value.projectId),
      crewId: nullableId('crews', value.crewId),
      leaderWorkerId: id('workers', value.leaderWorkerId),
      itemId: id('items', value.itemId),
      workerId: nullableId('workers', value.workerId),
      scope: value.scope.kind === 'project' ? { kind: 'project' } : { kind: 'cells', cells: value.scope.cells.map(cell => ({ unitId: id('units', cell.unitId), roomId: id('rooms', cell.roomId), itemId: id('items', cell.itemId) })) },
    }
  }
  function coverage(value: PayrollAAdjustmentCoverage): PayrollAAdjustmentCoverage {
    return {
      ...value,
      adjustmentId: id('payroll_adjustments', value.adjustmentId),
      rootAdjustmentId: id('payroll_adjustments', value.rootAdjustmentId),
      originalStatementId: id('wage_statements', value.originalStatementId),
      ownershipKey: ownership(value.ownershipKey),
      originalPriceRevisionId: id('payroll_a_price_revisions', value.originalPriceRevisionId),
      currentPriceRevisionId: nullableId('payroll_a_price_revisions', value.currentPriceRevisionId),
    }
  }
  function reconciliation(value: PayrollAAdjustmentReconciliation): PayrollAAdjustmentReconciliation {
    return { ...value, rawBasis: aBasis(value.rawBasis), effectiveBasis: aBasis(value.effectiveBasis), actualIdentities: value.actualIdentities.map(actualIdentity), coverage: value.coverage.map(coverage) }
  }
  function source(value: PayrollAStatementSourceSnapshot): PayrollAStatementSourceSnapshot {
    return {
      ...value,
      subject: { ...value.subject, projectId: id('projects', value.subject.projectId), crewId: nullableId('crews', value.subject.crewId), leaderWorkerId: id('workers', value.subject.leaderWorkerId), memberWorkerIds: value.subject.memberWorkerIds.map(value => id('workers', value)) },
      facts: value.facts.map(quantity),
      priceRevisions: value.priceRevisions.map(price),
      ...(value.adjustmentReconciliation ? { adjustmentReconciliation: reconciliation(value.adjustmentReconciliation) } : {}),
    }
  }
  function aBasis(value: PayrollAAdjustmentBasis): PayrollAAdjustmentBasis {
    return { ...value, source: source(value.source), components: value.components.map(component => ({ ...component, ownershipKey: ownership(component.ownershipKey), priceRevisionId: id('payroll_a_price_revisions', component.priceRevisionId) })) }
  }
  function basis(value: PayrollAdjustmentBasisDraft): PayrollAdjustmentBasisDraft {
    if (value.formatFamily === 'C1') {
      return {
        ...value,
        rates: value.rates.map(rate => ({ ...rate, workerId: id('workers', rate.workerId), configId: nullableId('payroll_c1_rate_revisions', rate.configId) })),
        records: value.records.map(record => ({ ...record, recordId: id('attendance_records', record.recordId), workerId: id('workers', record.workerId) })),
      }
    }
    if (value.formatFamily === 'C2')
      return { ...value, configId: id('payroll_subject_configs', value.configId), records: value.records.map(record => ({ ...record, recordId: id('signed_daywork_records', record.recordId), workerId: id('workers', record.workerId) })) }
    return aBasis(value)
  }
  function confirmed(value: PayrollAdjustmentConfirmedSnapshot): PayrollAdjustmentConfirmedSnapshot {
    return {
      ...value,
      id: id('payroll_adjustments', value.id),
      rootAdjustmentId: id('payroll_adjustments', value.rootAdjustmentId),
      correctsAdjustmentId: nullableId('payroll_adjustments', value.correctsAdjustmentId),
      original: original(value.original),
      preview: { ...value.preview, before: value.preview.before === null ? null : basis(value.preview.before), after: value.preview.after === null ? null : basis(value.preview.after), proofRefs: value.preview.proofRefs.map(proof) },
      commandId: id('payroll_command_receipts', value.commandId),
    }
  }
  function record(value: PayrollAdjustmentRecord): PayrollAdjustmentRecord {
    return {
      ...value,
      id: id('payroll_adjustments', value.id),
      rootAdjustmentId: id('payroll_adjustments', value.rootAdjustmentId),
      originalStatementId: id('wage_statements', value.originalStatementId),
      projectId: id('projects', value.projectId),
      draft: { ...value.draft, correctsAdjustmentId: nullableId('payroll_adjustments', value.draft.correctsAdjustmentId), basis: value.draft.basis === null ? null : basis(value.draft.basis) },
      snapshot: value.snapshot === null ? null : confirmed(value.snapshot),
    }
  }
  function diagnostic(value: PayrollSourceDiagnostic): PayrollSourceDiagnostic {
    if (value.recordId !== null && value.tableName === null)
      invalid('诊断记录缺少原表身份')
    // entityId/legacyRecordId 定位原迁入证据，不是业务表的中央身份。
    return { ...value, recordId: value.recordId === null ? null : id(value.tableName!, value.recordId), workerId: nullableId('workers', value.workerId) }
  }
  function fact(value: PayrollActualFact): PayrollActualFact {
    const expected = value.ref.kind === 'released-statement' ? `real:payroll:released:${value.ref.statementId}` : `real:payroll:actual:${value.ref.eventId}`
    if (value.identity !== expected)
      invalid('实际收付身份与原引用不一致')
    return {
      ...value,
      identity: actualIdentity(value.identity),
      ref: actualRef(value.ref),
      projectId: id('projects', value.projectId),
      originalStatementIds: value.originalStatementIds.map(value => id('wage_statements', value)),
      adjustmentIds: value.adjustmentIds.map(value => id('payroll_adjustments', value)),
      applicationIds: value.applicationIds.map(value => id('payroll_adjustment_applications', value)),
      reverses: value.reverses === null ? null : actualRef(value.reverses),
      allocations: value.allocations.map(allocation => ({ ...allocation, workerId: id('workers', allocation.workerId), crewId: nullableId('crews', allocation.crewId), proofRefs: allocation.proofRefs.map(proof) })),
      historicalMembers: value.historicalMembers.map(member => ({ ...member, workerId: id('workers', member.workerId), crewId: nullableId('crews', member.crewId) })),
      diagnostics: value.diagnostics.map(diagnostic),
    }
  }
  function snapshot(value: PayrollActualPaymentSnapshot | PayrollActualReversalSnapshot): PayrollActualPaymentSnapshot | PayrollActualReversalSnapshot {
    const mapped = { id: id('payroll_actual_events', value.id), commandId: id('payroll_command_receipts', value.commandId), projectId: id('projects', value.projectId), originals: value.originals.map(original), applicationIds: value.applicationIds.map(value => id('payroll_adjustment_applications', value)) }
    if ('kind' in value) {
      return { ...value, ...mapped, originalFact: fact(value.originalFact), applications: value.applications.map(application => ({ ...application, originalApplicationId: id('payroll_adjustment_applications', application.originalApplicationId), adjustmentId: id('payroll_adjustments', application.adjustmentId), rootAdjustmentId: id('payroll_adjustments', application.rootAdjustmentId) })) }
    }
    return { ...value, ...mapped, draft: { ...value.draft, allocations: value.draft.allocations.map(allocation => ({ ...allocation, workerId: id('workers', allocation.workerId) })), applications: value.draft.applications.map(application => ({ ...application, adjustmentId: id('payroll_adjustments', application.adjustmentId) })) } }
  }
  function navigation(value: NavigationIntentDTO): NavigationIntentDTO {
    if (value.kind === 'unavailable')
      return value
    if (value.kind !== 'entity-detail' || !['quantity-unit', 'worker', 'crew'].includes(value.subject.entity))
      return invalid('原 A 来源导航种类无法映射')
    const table = value.subject.entity === 'quantity-unit' ? 'units' : value.subject.entity === 'worker' ? 'workers' : 'crews'
    const subject = value.subject.state === 'resolved' ? { ...value.subject, id: id(table, value.subject.id) } : value.subject.state === 'forbidden' ? { ...value.subject, id: nullableId(table, value.subject.id) } : value.subject
    const fields: Record<string, string> = { projectId: 'projects', stageId: 'construction_stages', itemId: 'items', completionId: 'unit_stage_completions' }
    const filters = Object.fromEntries(Object.entries(value.filters).map(([field, value]) => {
      if (field === 'dataOrigin')
        return [field, value]
      const table = fields[field]
      if (!table)
        return invalid('原 A 来源导航包含未声明身份')
      return [field, nullableId(table, value)]
    }))
    return { ...value, subject, filters }
  }
  function aBlocker(value: PayrollABlocker): PayrollABlocker {
    return { ...value, completionId: nullableId('unit_stage_completions', value.completionId), assignmentId: nullableId('unit_assignments', value.assignmentId), unitId: nullableId('units', value.unitId), roomId: nullableId('rooms', value.roomId), itemId: nullableId('items', value.itemId), workerId: nullableId('workers', value.workerId), statementId: nullableId('wage_statements', value.statementId), source: value.source === null ? null : navigation(value.source) }
  }
  function aLine(value: PayrollALine): PayrollALine {
    let parts: unknown
    try {
      parts = JSON.parse(value.id)
    }
    catch { return invalid('原 A 工资行身份不可确认') }
    if (!Array.isArray(parts) || parts.length !== 6 || parts.slice(0, 4).some(value => typeof value !== 'string') || (parts[4] !== null && typeof parts[4] !== 'string') || (parts[5] !== null && typeof parts[5] !== 'string'))
      return invalid('原 A 工资行身份不是约定的计价组')
    const lineId = JSON.stringify([id('workers', parts[0]), id('buildings', parts[1]), id('house_type_templates', parts[2]), id('items', parts[3]), parts[4], nullableId('payroll_a_price_revisions', parts[5])])
    return { ...value, id: lineId, workerId: id('workers', value.workerId), itemId: id('items', value.itemId), priceRevisionIds: value.priceRevisionIds.map(value => id('payroll_a_price_revisions', value)), facts: value.facts.map(quantity), sources: value.sources.map(navigation), blockers: value.blockers.map(aBlocker) }
  }
  function aDocument(value: PayrollAFrozenDocument): PayrollAFrozenDocument {
    return { ...value, id: id('wage_statements', value.id), projectId: id('projects', value.projectId), lines: value.lines.map(aLine), members: value.members.map(member => ({ ...member, workerId: id('workers', member.workerId) })), allocations: value.allocations.map(allocation => ({ ...allocation, workerId: id('workers', allocation.workerId) })), previousPayments: value.previousPayments.map(payment => ({ ...payment, statementId: id('wage_statements', payment.statementId) })), ...(value.adjustmentReconciliation ? { adjustmentReconciliation: reconciliation(value.adjustmentReconciliation) } : {}) }
  }
  function c1Document(value: PayrollC1FrozenDocument): PayrollC1FrozenDocument {
    return { ...value, id: id('wage_statements', value.id), projectId: id('projects', value.projectId), crewId: nullableId('crews', value.crewId), lines: value.lines.map(line => ({ ...line, id: `${id('workers', line.workerId)}:${line.kind}`, workerId: id('workers', line.workerId), attendanceIds: line.attendanceIds.map(value => id('attendance_records', value)) })), rates: value.rates.map(rate => ({ ...rate, workerId: id('workers', rate.workerId), configId: nullableId('payroll_c1_rate_revisions', rate.configId) })), attendance: value.attendance.map(fact => ({ ...fact, id: id('attendance_records', fact.id), projectId: id('projects', fact.projectId), crewId: nullableId('crews', fact.crewId), workerId: id('workers', fact.workerId) })), members: value.members.map(member => ({ ...member, workerId: id('workers', member.workerId) })), allocations: value.allocations.map(allocation => ({ ...allocation, workerId: id('workers', allocation.workerId) })) }
  }
  function c2Document(value: PayrollC2FrozenDocument): PayrollC2OutputDocument {
    const selected = new Map<string, PayrollC2OutputIdentity>()
    const take = (tableName: PayrollC2OutputIdentity['tableName'], legacyId: string): string => {
      const centralId = id(tableName, legacyId)
      selected.set(key(tableName, legacyId), { tableName, legacyId, centralId })
      return centralId
    }
    const maybe = (tableName: PayrollC2OutputIdentity['tableName'], legacyId: string | null) => legacyId === null ? null : take(tableName, legacyId)
    const document = { ...value, id: take('wage_statements', value.id), projectId: take('projects', value.projectId), crewId: maybe('crews', value.crewId), lines: value.lines.map(line => ({ ...line, id: `${take('workers', line.workerId)}:daywork`, workerId: take('workers', line.workerId), dayworkIds: line.dayworkIds.map(value => take('signed_daywork_records', value)) })), daywork: value.daywork.map(fact => ({ ...fact, id: take('signed_daywork_records', fact.id), projectId: take('projects', fact.projectId), crewId: maybe('crews', fact.crewId), workerId: take('workers', fact.workerId) })), config: { ...value.config, id: take('payroll_subject_configs', value.config.id), projectId: take('projects', value.config.projectId), crewId: maybe('crews', value.config.crewId), leaderWorkerId: take('workers', value.config.leaderWorkerId) }, members: value.members.map(member => ({ ...member, workerId: take('workers', member.workerId) })), allocations: value.allocations.map(allocation => ({ ...allocation, workerId: take('workers', allocation.workerId) })) }
    return { ...document, identityMapping: [...selected.values()] }
  }
  return { original, basis, record, fact, snapshot, aDocument, c1Document, c2Document }
}
