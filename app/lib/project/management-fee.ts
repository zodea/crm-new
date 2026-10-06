import type { DataOriginDTO, MetricDTO } from '../../types/read-model'
import type { PayrollActualRef } from '../payroll/central-actual-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { isMetricDTO } from '../read-model/metric'

export type ManagementFeeSourceKey = 'management-payroll' | 'contract-management' | 'other-management'
export interface ProjectManagementFeeRow {
  identity: string
  ref: PayrollActualRef
  originalStatementIds: string[]
  managementBookId: string
  amount: string | null
  knownValue: string | null
  occurredOn: string | null
  sourceVersion: string
}
export interface ProjectManagementFeeSource {
  key: ManagementFeeSourceKey
  state: 'complete' | 'partial' | 'forbidden' | 'unavailable'
  sourceVersion: string | null
  asOf: string | null
  reasons: string[]
  missingCount: number | null
  rows: ProjectManagementFeeRow[]
  actualCost: MetricDTO
}
export interface ProjectManagementFeeRead {
  projectId: string
  dataOrigin: DataOriginDTO
  actualCost: MetricDTO
  sources: ProjectManagementFeeSource[]
}
export const MANAGEMENT_FEE_SOURCE_LABELS: Record<ManagementFeeSourceKey, string> = {
  'management-payroll': '管理人员：独立管理簿',
  'contract-management': '合同记取及实际成本归属',
  'other-management': '仓储等原费用归属',
}
const money = (value: unknown): value is string => typeof value === 'string' && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(value)
function sum(values: string[]): string {
  const zero = BigInt(0)
  const hundred = BigInt(100)
  const total = values.reduce((amount, value) => amount + BigInt(value.replace('.', '')), zero)
  const absolute = total < zero ? -total : total
  return `${total < zero ? '-' : ''}${absolute / hundred}.${String(absolute % hundred).padStart(2, '0')}`
}
function metric(input: { value: string | null, knownValue: string | null, status: MetricDTO['status'], missingSources: string[], participatingCount: number | null, missingCount: number | null, asOf: string }): MetricDTO {
  return { ...input, unit: 'CNY', quantityUnit: null, drilldown: null }
}
export function managementFeeSource(input: Omit<ProjectManagementFeeSource, 'actualCost'>, asOf: string): ProjectManagementFeeSource {
  const readable = input.state === 'complete' || input.state === 'partial'
  const known = readable ? sum(input.rows.flatMap(row => row.knownValue === null ? [] : [row.knownValue])) : null
  return { ...input, actualCost: metric({ value: input.state === 'complete' ? known : null, knownValue: known, status: input.state === 'complete' ? 'complete' : readable ? 'partial' : 'pending', missingSources: input.state === 'complete' ? [] : input.reasons, participatingCount: readable ? input.rows.length : null, missingCount: input.missingCount, asOf }) }
}
export function projectManagementFees(projectId: string, dataOrigin: DataOriginDTO, asOf: string, payroll?: ProjectManagementFeeSource): ProjectManagementFeeRead {
  const unavailable = (key: ManagementFeeSourceKey, reason: string) => managementFeeSource({ key, state: 'unavailable', sourceVersion: null, asOf: null, reasons: [reason], missingCount: null, rows: [] }, asOf)
  const sources = [
    payroll ?? unavailable('management-payroll', '当前来源尚无可证明的独立管理簿实际事实'),
    unavailable('contract-management', '合同记取的实际发生及费用归属尚未接入'),
    unavailable('other-management', '仓储等原费用的明确管理费归属尚未接入'),
  ]
  const known = sources.flatMap(source => source.actualCost.knownValue === null ? [] : [String(source.actualCost.knownValue)])
  return { projectId, dataOrigin, sources, actualCost: metric({ value: null, knownValue: known.length ? sum(known) : null, status: known.length ? 'partial' : 'pending', missingSources: sources.flatMap(source => source.actualCost.missingSources), participatingCount: null, missingCount: null, asOf }) }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).sort().join(',') === names.sort().join(',')
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim()
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (object(value))
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right)
/** The source proof and row sum must agree; a client cannot promote a subtotal to a complete fee. */
export function isProjectManagementFeeRead(value: unknown, expected: { projectId: string, dataOrigin: DataOriginDTO, asOf: string }): value is ProjectManagementFeeRead {
  if (!object(value) || !keys(value, ['projectId', 'dataOrigin', 'sources', 'actualCost']) || value.projectId !== expected.projectId || value.dataOrigin !== expected.dataOrigin || !isMetricDTO(value.actualCost) || value.actualCost.asOf !== expected.asOf || !Array.isArray(value.sources) || value.sources.length !== 3)
    return false
  const sourceKeys = ['management-payroll', 'contract-management', 'other-management']
  const identities = new Set<string>()
  for (const [index, source] of value.sources.entries()) {
    if (!object(source) || !keys(source, ['key', 'state', 'sourceVersion', 'asOf', 'reasons', 'missingCount', 'rows', 'actualCost']) || source.key !== sourceKeys[index] || !['complete', 'partial', 'forbidden', 'unavailable'].includes(String(source.state)) || !Array.isArray(source.reasons) || !source.reasons.every(id) || !(source.missingCount === null || (Number.isSafeInteger(source.missingCount) && Number(source.missingCount) >= 0)) || !Array.isArray(source.rows) || !isMetricDTO(source.actualCost))
      return false
    const readable = source.state === 'complete' || source.state === 'partial'
    if (readable ? !id(source.sourceVersion) || !isISODateTimeDTO(source.asOf) : source.sourceVersion !== null || source.asOf !== null || source.rows.length !== 0)
      return false
    if (source.key !== 'management-payroll' && (source.state !== 'unavailable' || source.rows.length))
      return false
    for (const row of source.rows) {
      if (!object(row) || !keys(row, ['identity', 'ref', 'originalStatementIds', 'managementBookId', 'amount', 'knownValue', 'occurredOn', 'sourceVersion']) || !id(row.identity) || identities.has(row.identity) || !id(row.managementBookId) || !id(row.sourceVersion) || !(row.amount === null || money(row.amount)) || !(row.knownValue === null || money(row.knownValue)) || (row.amount !== null && row.knownValue !== row.amount) || !(row.occurredOn === null || isISODateDTO(row.occurredOn)) || !Array.isArray(row.originalStatementIds) || row.originalStatementIds.length === 0 || !row.originalStatementIds.every(id) || new Set(row.originalStatementIds).size !== row.originalStatementIds.length || !object(row.ref))
        return false
      if (row.ref.kind === 'released-statement' ? !keys(row.ref, ['kind', 'statementId']) || !id(row.ref.statementId) || !row.originalStatementIds.includes(row.ref.statementId) : row.ref.kind !== 'actual-event' || !keys(row.ref, ['kind', 'eventId']) || !id(row.ref.eventId))
        return false
      identities.add(row.identity)
    }
    if (source.state === 'complete' && (source.reasons.length || source.missingCount !== 0 || source.rows.some(row => row.amount === null)))
      return false
    const candidate = source as unknown as ProjectManagementFeeSource
    if (!same(candidate.actualCost, managementFeeSource(candidate, expected.asOf).actualCost))
      return false
  }
  const regenerated = projectManagementFees(expected.projectId, expected.dataOrigin, expected.asOf, value.sources[0] as ProjectManagementFeeSource)
  return same(value.actualCost, regenerated.actualCost) && value.sources.slice(1).every((source, index) => same(source, regenerated.sources[index + 1]))
}
