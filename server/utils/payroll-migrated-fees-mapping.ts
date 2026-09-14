import type { PayrollABlocker, PayrollAQuantityFact } from '../../app/lib/payroll/central-a-contract'
import type { PayrollABookRef, PayrollAFeeAdjustmentBasis, PayrollAFeeDefaultAdoption, PayrollAFeeLine, PayrollAFeeRevision, PayrollAFeesSourceSnapshot, PayrollAManagementBook, PayrollAManagementBookRevision, PayrollAManagementOwnership, PayrollAManagementScope, PayrollANegativeLineRevision } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollActualRef } from '../../app/lib/payroll/central-actual-contract'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { NavigationIntentDTO } from '../../app/types/read-model'
import { payrollProblem } from '../../app/lib/payroll/central-contract'

interface Dependencies {
  mapping: PayrollIdentityMapping[]
  id: (table: string, value: string) => string
  nullableId: (table: string, value: string | null) => string | null
  ownership: (value: string) => string
  quantity: (value: PayrollAQuantityFact) => PayrollAQuantityFact
  actualRef: (value: PayrollActualRef) => PayrollActualRef
  navigation: (value: NavigationIntentDTO) => NavigationIntentDTO
  blocker: (value: PayrollABlocker) => PayrollABlocker
}
/** 系列/行/组件按各自封闭身份构造消费 DTO；原证据字符串与签名保持原值。 */
export function createPayrollMigratedFeesMapper(d: Dependencies) {
  const { id, nullableId, ownership } = d
  const fail = (): never => {
    throw payrollProblem('unavailable', '迁入费用系列或组件身份无法证明')
  }
  function series(table: string, namespace: string, value: string): string {
    const owners = new Set(d.mapping.filter(row => row.tableName === table && row.centralId).map((row) => {
      const suffix = `:${table}:${encodeURIComponent(row.legacyId)}`
      if (!row.centralId!.endsWith(suffix) || row.centralId!.length === suffix.length)
        return fail()
      return row.centralId!.slice(0, -suffix.length)
    }))
    if (owners.size !== 1)
      return fail()
    return `${[...owners][0]}:${namespace}:${encodeURIComponent(value)}`
  }
  const feeId = (value: string) => series('payroll_a_fee_revisions', 'payroll-fee', value)
  const lineId = (value: string) => series('payroll_a_negative_lines', 'payroll-negative-line', value)
  function componentKey(value: string) {
    let parts: unknown
    try {
      parts = JSON.parse(value)
    }
    catch { return fail() }
    if (!Array.isArray(parts) || parts.length !== 2 || parts.some(part => typeof part !== 'string') || JSON.stringify(parts) !== value)
      return fail()
    return JSON.stringify([feeId(parts[0]), ownership(parts[1])])
  }
  function book(value: PayrollABookRef): PayrollABookRef {
    return value.bookPurpose === 'ordinary' ? { ...value } : { ...value, managementBookId: id('payroll_a_management_books', value.managementBookId) }
  }
  const cell = (value: { unitId: string, roomId: string, itemId: string }) => ({ ...value, unitId: id('units', value.unitId), roomId: id('rooms', value.roomId), itemId: id('items', value.itemId) })
  function scope(value: PayrollAManagementScope): PayrollAManagementScope {
    return { assignments: value.assignments.map(row => ({ ...row, assignmentId: id('unit_assignments', row.assignmentId), scopeIds: row.scopeIds.map(value => id('unit_assignment_scopes', value)), cells: row.cells.map(cell) })) }
  }
  function adoption(value: PayrollAFeeDefaultAdoption | null): PayrollAFeeDefaultAdoption | null {
    return value === null ? null : value.kind === 'confirmed-housing-items' ? { ...value, itemIds: value.itemIds.map(value => id('items', value)) } : { ...value, fact: { ...value.fact, crewId: id('crews', value.fact.crewId) } }
  }
  function revision(value: PayrollAFeeRevision): PayrollAFeeRevision {
    return { ...value, ...book(value), id: id('payroll_a_fee_revisions', value.id), feeId: feeId(value.feeId), projectId: id('projects', value.projectId), crewId: nullableId('crews', value.crewId), leaderWorkerId: id('workers', value.leaderWorkerId), basis: { ...value.basis, itemIds: value.basis.itemIds.map(value => id('items', value)), scope: value.basis.scope.kind === 'project' ? { kind: 'project' } : { kind: 'cells', cells: value.basis.scope.cells.map(cell) } }, adoptedDefault: adoption(value.adoptedDefault) } as PayrollAFeeRevision
  }
  function negative(value: PayrollANegativeLineRevision): PayrollANegativeLineRevision {
    return { ...value, id: id('payroll_a_negative_lines', value.id), lineId: lineId(value.lineId), statementId: id('wage_statements', value.statementId), projectId: id('projects', value.projectId), managementBookId: id('payroll_a_management_books', value.managementBookId), managementRevisionId: id('payroll_a_management_book_revisions', value.managementRevisionId), scope: scope(value.scope), actualRef: value.actualRef === null ? null : d.actualRef(value.actualRef) }
  }
  function claim(value: PayrollAManagementOwnership): PayrollAManagementOwnership {
    const proof = value.proof
    return { ...value, id: id('payroll_a_management_ownership', value.id), projectId: id('projects', value.projectId), ownershipKey: ownership(value.ownershipKey), managementBookId: id('payroll_a_management_books', value.managementBookId), firstStatementId: id('wage_statements', value.firstStatementId), proof: { ...proof, identity: { ...proof.identity, projectId: id('projects', proof.identity.projectId), ownershipKey: ownership(proof.identity.ownershipKey) }, managementBookId: id('payroll_a_management_books', proof.managementBookId), managementRevisionId: id('payroll_a_management_book_revisions', proof.managementRevisionId), firstStatementId: id('wage_statements', proof.firstStatementId), firstCommandId: id('payroll_command_receipts', proof.firstCommandId), fact: d.quantity(proof.fact) } }
  }
  function line(value: PayrollAFeeLine): PayrollAFeeLine {
    let parts: unknown
    try {
      parts = JSON.parse(value.id)
    }
    catch { return fail() }
    if (!Array.isArray(parts) || parts.length !== 5 || parts[0] !== value.feeId || typeof parts[1] !== 'string' || parts[2] !== value.buildingId || parts[3] !== value.itemId || parts[4] !== value.unit)
      return fail()
    return { ...value, id: JSON.stringify([feeId(value.feeId), id('payroll_a_fee_revisions', parts[1]), nullableId('buildings', value.buildingId), id('items', value.itemId), value.unit]), feeId: feeId(value.feeId), feeRevisionIds: value.feeRevisionIds.map(value => id('payroll_a_fee_revisions', value)), buildingId: nullableId('buildings', value.buildingId), itemId: id('items', value.itemId), components: value.components.map(component => ({ ...component, componentKey: componentKey(component.componentKey), feeId: feeId(component.feeId), feeRevisionId: id('payroll_a_fee_revisions', component.feeRevisionId), ownershipKey: ownership(component.ownershipKey), managementOwnership: component.managementOwnership === null ? null : { ...component.managementOwnership, projectId: id('projects', component.managementOwnership.projectId), ownershipKey: ownership(component.managementOwnership.ownershipKey) }, fact: d.quantity(component.fact) })), sources: value.sources.map(d.navigation), blockers: value.blockers.map(value => ({ ...value, ...d.blocker(value), feeId: value.feeId === null ? null : feeId(value.feeId), managementBookId: nullableId('payroll_a_management_books', value.managementBookId), negativeLineId: value.negativeLineId === null ? null : lineId(value.negativeLineId) })) }
  }
  function fees(value: PayrollAFeesSourceSnapshot): PayrollAFeesSourceSnapshot {
    const management = value.management
    return { ...value, crewDefaults: value.crewDefaults === null ? null : { ...value.crewDefaults, crewId: id('crews', value.crewDefaults.crewId) }, feeRevisions: value.feeRevisions.map(revision), management: management === null ? null : { book: { ...management.book, id: id('payroll_a_management_books', management.book.id), projectId: id('projects', management.book.projectId), managerWorkerId: nullableId('workers', management.book.managerWorkerId) }, revision: { ...management.revision, id: id('payroll_a_management_book_revisions', management.revision.id), managementBookId: id('payroll_a_management_books', management.revision.managementBookId), projectId: id('projects', management.revision.projectId), scope: scope(management.revision.scope) } }, managementOwnership: value.managementOwnership.map(claim), negativeLines: value.negativeLines.map(negative), lines: value.lines.map(line) }
  }
  function managementBook(value: PayrollAManagementBook): PayrollAManagementBook {
    return { ...value, id: id('payroll_a_management_books', value.id), projectId: id('projects', value.projectId), managerWorkerId: nullableId('workers', value.managerWorkerId) }
  }
  function managementRevision(value: PayrollAManagementBookRevision): PayrollAManagementBookRevision {
    return { ...value, id: id('payroll_a_management_book_revisions', value.id), managementBookId: id('payroll_a_management_books', value.managementBookId), projectId: id('projects', value.projectId), scope: scope(value.scope) }
  }
  function basis(value: PayrollAFeeAdjustmentBasis): PayrollAFeeAdjustmentBasis {
    return { ...value, book: book(value.book), components: value.components.map(component => ({ ...component, componentKey: componentKey(component.componentKey), feeId: feeId(component.feeId), feeRevisionId: id('payroll_a_fee_revisions', component.feeRevisionId), ownershipKey: ownership(component.ownershipKey) })), negativeLines: value.negativeLines.map(value => ({ ...value, lineId: lineId(value.lineId), originalNegativeRevisionId: id('payroll_a_negative_lines', value.originalNegativeRevisionId), scope: scope(value.scope), actualRef: value.actualRef === null ? null : d.actualRef(value.actualRef) })) }
  }
  return { book, fees, basis, componentKey, feeId, lineId, revision, negative, claim, managementBook, managementRevision }
}
