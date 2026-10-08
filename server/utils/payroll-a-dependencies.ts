import type { PayrollACommand, PayrollAConfigRead, PayrollAFormRead, PayrollAPriceRevision, PayrollAPriceScope } from '../../app/lib/payroll/central-a-contract'
import type { PayrollIdentitySource } from './payroll-service'
import { Buffer } from 'node:buffer'
import { hasPayrollAFeesForm } from '../../app/lib/payroll/central-a-fees-contract'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollDependencyHash as hash } from './payroll-dependency-version'

const prefix = 'payroll-a-dependencies-v1:'
interface PriceBasis { priceId: string, itemId: string, unit: string | null, mode: string, workerId: string | null, scope: PayrollAPriceScope, digest: string }
interface Basis { schemaVersion: 1, kind: 'form' | 'config', scope: string, common: string, view: string, records: Record<string, string>, people: Record<string, string>, prices: PriceBasis[], items: string[], cells: string[] }
const ordered = <T>(rows: readonly T[]) => [...rows].sort((left, right) => payrollCanonical(left).localeCompare(payrollCanonical(right)))
const key = (...values: unknown[]) => payrollCanonical(values)
const version = (basis: Basis) => `${prefix}${Buffer.from(payrollCanonical(basis)).toString('base64url')}`
function priceValue(price: PayrollAPriceRevision) {
  const { itemName: _itemName, workerName: _workerName, editable: _editable, readonlyReasons: _readonlyReasons, ...value } = price
  return value
}
function priceScopeValue(scope: PayrollAPriceScope): PayrollAPriceScope {
  return scope.kind === 'project' ? { kind: 'project' } : { kind: 'cells', cells: scope.cells.map(cell => ({ unitId: cell.unitId, roomId: cell.roomId, itemId: cell.itemId })) }
}
function members(source: PayrollIdentitySource, ids: readonly string[]) {
  return Object.fromEntries(ids.map((id) => {
    const worker = source.workers.find(row => row.id === id)
    return [id, hash(worker ? { id, name: worker.name, crewId: worker.crewId } : null)]
  }))
}
/** Excludes the candidate directory and prices which did not enter these wage lines. */
export function payrollAConsumedCalculation(read: PayrollAFormRead, source: PayrollIdentitySource) {
  const selectedPrices = read.prices.filter(price => read.lines.some(line => line.priceRevisionIds.includes(price.id)))
  const value = hasPayrollAFeesForm(read) ? read.fees : undefined
  const fees = value ? { ...value, configSourceVersion: undefined, crewDefaults: value.crewDefaults ? { ...value.crewDefaults, sourceVersion: undefined } : null } : undefined
  return { draft: { ...read.draft, note: undefined }, facts: ordered(read.facts), prices: ordered(selectedPrices.map(priceValue)), people: members(source, read.draft.memberWorkerIds ?? []), project: source.projects.find(project => project.id === read.draft.projectId) ?? null, crew: source.crews.find(crew => crew.id === read.draft.crewId)?.name ?? null, paymentSourceVersion: read.paymentSourceVersion, fees, reconciliation: read.adjustmentReconciliation, hollow: read.hollow?.snapshot }
}
export function payrollAFormDependencyVersion(read: PayrollAFormRead, source: PayrollIdentitySource, originalHead: unknown) {
  return version({ schemaVersion: 1, kind: 'form', scope: hash({ statementId: read.statementId, draftKey: read.draftKey, projectId: read.draft.projectId, crewId: read.draft.crewId, leaderWorkerId: read.draft.leaderWorkerId, month: read.draft.month, periodKind: read.draft.periodKind, book: read.draft.book }), common: hash(originalHead), view: hash(read), records: { calculation: hash(payrollAConsumedCalculation(read, source)), membership: hash(read.draft.memberWorkerIds), qualification: hash({ blockers: read.blockers.map(row => [row.code, row.field, row.completionId, row.assignmentId, row.unitId, row.roomId, row.itemId, row.workerId]), eligibility: read.eligibility }) }, people: members(source, read.draft.memberWorkerIds ?? []), prices: [], items: [], cells: [] })
}
export function payrollAConfigDependencyVersion(read: PayrollAConfigRead, source: PayrollIdentitySource, facts: { rows: Array<{ itemId: string, unit: string | null, unitId: string, roomId: string }> }, locks: Record<string, string[]>) {
  const scope = read.scope
  return version({ schemaVersion: 1, kind: 'config', scope: hash(scope), common: hash({ projectAvailable: source.projects.some(project => project.id === scope.projectId), crewAvailable: scope.crewId === null || source.crews.some(crew => crew.id === scope.crewId), leader: scope.leaderWorkerId === null ? null : members(source, [scope.leaderWorkerId]) }), view: hash(read), records: { subject: hash(read.subject), ...Object.fromEntries(Object.entries(locks).map(([month, ids]) => [`lock:${month}`, hash(ordered(ids))])) }, people: members(source, source.workers.map(worker => worker.id)), prices: read.prices.map(price => ({ priceId: price.priceId, itemId: price.itemId, unit: price.unit, mode: price.mode, workerId: price.workerId, scope: priceScopeValue(price.scope), digest: hash(priceValue(price)) })), items: [...new Set(facts.rows.map(row => key(row.itemId, row.unit)))].sort(), cells: [...new Set(facts.rows.map(row => key(row.unitId, row.roomId, row.itemId)))].sort() })
}
function parse(value: string): Basis {
  if (!value.startsWith(prefix))
    throw payrollProblem('stale-source', '原A工资依赖版本尚未按实际采用范围核对，请保留输入重新读取')
  let basis: Basis
  try {
    basis = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'))
  }
  catch { throw payrollProblem('stale-source', '原A工资采用指纹无法核实') }
  const scopeValid = (scope: PayrollAPriceScope | undefined) => !!scope && typeof scope === 'object' && (scope.kind === 'project' ? Object.keys(scope).join(',') === 'kind' : scope.kind === 'cells' && Object.keys(scope).sort().join(',') === 'cells,kind' && Array.isArray(scope.cells) && scope.cells.every(cell => !!cell && typeof cell === 'object' && Object.keys(cell).sort().join(',') === 'itemId,roomId,unitId' && [cell.unitId, cell.roomId, cell.itemId].every(value => typeof value === 'string' && value.length > 0)))
  if (!basis || typeof basis !== 'object' || Array.isArray(basis) || basis.schemaVersion !== 1 || !['form', 'config'].includes(basis.kind) || version(basis) !== value || Object.keys(basis).sort().join(',') !== 'cells,common,items,kind,people,prices,records,schemaVersion,scope,view' || ![basis.scope, basis.common, basis.view].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) || [basis.records, basis.people].some(rows => !rows || typeof rows !== 'object' || Array.isArray(rows) || Object.values(rows).some(value => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) || !Array.isArray(basis.prices) || basis.prices.some(price => !price || typeof price !== 'object' || Object.keys(price).sort().join(',') !== 'digest,itemId,mode,priceId,scope,unit,workerId' || !['baseline', 'worker-exception'].includes(price.mode) || ![price.priceId, price.itemId].every(value => typeof value === 'string' && value.length > 0) || (price.workerId !== null && typeof price.workerId !== 'string') || (price.unit !== null && typeof price.unit !== 'string') || !/^[a-f0-9]{64}$/.test(price.digest) || !scopeValid(price.scope)) || !Array.isArray(basis.items) || !basis.items.every(value => typeof value === 'string') || !Array.isArray(basis.cells) || !basis.cells.every(value => typeof value === 'string'))
    throw payrollProblem('stale-source', 'A工资版本向量格式无法核实')
  return basis
}
function overlaps(left: PayrollAPriceScope, right: PayrollAPriceScope) {
  return left.kind === 'project' || right.kind === 'project' || left.cells.some(cell => right.cells.some(other => key(cell.unitId, cell.roomId, cell.itemId) === key(other.unitId, other.roomId, other.itemId)))
}
export function assertPayrollAConsumedDependencies(original: string, current: string, command: PayrollACommand) {
  if (!current.startsWith(prefix)) {
    if (original !== current)
      throw payrollProblem('stale-source', '工资核算来源或此前实付已变化，请保留输入重新读取')
    return
  }
  const before = parse(original)
  const after = parse(current)
  const changed = (): never => {
    throw payrollProblem('stale-source', '本次采用的A工资原单、责任、价格、成员、已付或配置已变化，请保留输入重新读取')
  }
  const same = (left: unknown, right: unknown) => {
    if (payrollCanonical(left) !== payrollCanonical(right))
      changed()
  }
  same([before.kind, before.scope, before.common], [after.kind, after.scope, after.common])
  const lock = (basis: Basis, month: string) => basis.records[`lock:${month}`] ?? hash([])
  if (before.kind === 'form') {
    if (command.action.kind !== 'set-a-pay-ratio')
      same([before.records, before.people], [after.records, after.people])
    return
  }
  const scope = command.configScope!
  same(lock(before, scope.month), lock(after, scope.month))
  if (command.action.kind === 'save-a-subject-config') {
    same(before.records.subject, after.records.subject)
    return
  }
  const action = command.action
  if (action.kind !== 'save-a-prices')
    return changed()
  for (const draft of action.prices) {
    same(lock(before, draft.effectiveMonth), lock(after, draft.effectiveMonth))
    if (draft.workerId)
      same(before.people[draft.workerId], after.people[draft.workerId])
    same(before.items.includes(key(draft.itemId, draft.unit)), after.items.includes(key(draft.itemId, draft.unit)))
    if (draft.scope.kind === 'cells') {
      for (const cell of draft.scope.cells)
        same(before.cells.includes(key(cell.unitId, cell.roomId, cell.itemId)), after.cells.includes(key(cell.unitId, cell.roomId, cell.itemId)))
    }
    const relevant = (basis: Basis) => ordered(basis.prices.filter(price => price.priceId === draft.priceId || (price.itemId === draft.itemId && price.unit === draft.unit && price.mode === draft.mode && price.workerId === draft.workerId && overlaps(price.scope, draft.scope))))
    same(relevant(before), relevant(after))
  }
}
