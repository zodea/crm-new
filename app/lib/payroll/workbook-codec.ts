import type { PayrollAOutputRead } from './central-a-contract'
import type { PayrollActualLedgerRead } from './central-actual-contract'
import type { PayrollC1OutputRead } from './central-c1-contract'
import type { PayrollC2OutputRead } from './central-c2-contract'
import type { PayrollListRead, PayrollQuery } from './central-contract'
import type { PayrollWorkbookArchive, PayrollWorkbookArchiveSummary, PayrollWorkbookInput, PayrollWorkbookPreview, PayrollWorkbookResult } from './central-workbook-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { rosterDate } from '../worker-roster/validation'
import { decodePayrollARead, encodePayrollAWire } from './central-a-codec'
import { decodePayrollAdjustmentRead } from './central-adjustment-read-codec'
import { encodePayrollAdjustmentWire } from './central-adjustment-wire'
import { decodePayrollC1Read, encodePayrollC1Wire } from './central-c1-codec'
import { decodePayrollC2Read, encodePayrollC2Wire } from './central-c2-codec'
import { decodePayrollRead, encodePayrollWire } from './central-codec'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { numberingExact as exact, isPayrollOfficialIssue, numberingObject as object } from './central-numbering-codec'
import { payrollWorkbookSubjectKey } from './workbook-subject'
import { parsePayrollWorkbookInput, workbookText } from './workbook-validation'

const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0
const timestamp = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
const same = (a: unknown, b: unknown) => payrollCanonical(a) === payrollCanonical(b)
function invalid(): never {
  throw payrollProblem('unavailable', '工资输出目录读取不完整或与固定范围不一致')
}
function rosterRef(value: unknown) {
  return value === null || (object(value) && exact(value, ['id', 'version', 'registeredOn', 'sourceVersion', 'contentHash']) && isStableRouteIdentity(value.id) && positive(value.version) && rosterDate(value.registeredOn) && workbookText(value.sourceVersion) && sha(value.contentHash))
}
const common = ['context', 'input', 'sourceVersion', 'projectName', 'groups', 'gaps', 'deliveryGaps', 'issues', 'rosterRef']
export function encodePayrollWorkbookRead(value: PayrollWorkbookPreview | PayrollWorkbookArchive) {
  return { ...value, groups: value.groups.map(group => ({ ...group, actualLedger: encodePayrollAdjustmentWire(group.actualLedger), entries: group.entries.map(entry => ({ row: encodePayrollWire(entry.row), document: entry.document.formatFamily === 'A' ? encodePayrollAWire(entry.document) : entry.document.formatFamily === 'C1' ? encodePayrollC1Wire(entry.document) : encodePayrollC2Wire(entry.document) })) })) }
}
export function decodePayrollWorkbookRead<T extends PayrollWorkbookPreview | PayrollWorkbookArchive>(raw: unknown, kind: 'preview' | 'archive', query: PayrollQuery, target: PayrollWorkbookInput | { projectId: string, archiveId: string }): T {
  if (!object(raw) || !exact(raw, [...common, ...(kind === 'preview' ? ['roster', 'eligibility'] : ['schemaVersion', 'id', 'version', 'createdAt', 'createdBy', 'manifestHash', 'completeness', ...(Object.hasOwn(raw, 'migration') ? ['migration'] : [])])]) || !object(raw.context))
    invalid()
  if (raw.migration !== undefined && (kind !== 'archive' || !object(raw.migration) || !exact(raw.migration, ['originalId', 'originalContentHash']) || !isStableRouteIdentity(raw.migration.originalId) || !sha(raw.migration.originalContentHash) || raw.migration.originalContentHash !== raw.manifestHash))
    invalid()
  const c = raw.context
  if (query.origin !== 'real' || c.origin !== 'real' || ![c.workspaceId, c.actorId].every(isStableRouteIdentity) || !Array.isArray(c.capabilities) || !c.capabilities.every(item => typeof item === 'string')
    || !c.capabilities.includes('payroll:read') || c.readonly !== !c.capabilities.includes('payroll:write') || c.sourceVersion !== raw.sourceVersion || !sha(raw.sourceVersion) || !workbookText(raw.projectName) || !rosterRef(raw.rosterRef)) {
    invalid()
  }
  const input = parsePayrollWorkbookInput(raw.input)
  if (input.projectId !== target.projectId || (query.projectId && query.projectId !== input.projectId) || (kind === 'preview' && !same(input, parsePayrollWorkbookInput(target))))
    invalid()
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.gaps) || !Array.isArray(raw.deliveryGaps) || !Array.isArray(raw.issues) || !raw.issues.every(isPayrollOfficialIssue))
    invalid()
  const selected = new Set(input.statementIds)
  const seen = new Set<string>()
  const scopeSeen = new Set<string>()
  const groupKeys = new Set<string>()
  const groups = raw.groups.map((group) => {
    if (!object(group) || !exact(group, ['key', 'label', 'entries', 'actualLedger']) || !workbookText(group.key) || groupKeys.has(group.key) || !workbookText(group.label) || !Array.isArray(group.entries))
      invalid()
    groupKeys.add(group.key)
    const entries = group.entries.map((entry) => {
      if (!object(entry) || !exact(entry, ['row', 'document']) || !object(entry.row) || !object(entry.document) || !selected.has(String(entry.row.id)) || seen.has(String(entry.row.id)))
        invalid()
      const row = decodePayrollRead<PayrollListRead>({ context: { ...c, readonly: true }, rows: [entry.row], projects: [], diagnostics: [] }, 'list', { origin: 'real', projectId: input.projectId }).rows[0]!
      const output = { context: c, statementId: row.id, state: 'available', document: entry.document, reasons: [] }
      const q = { origin: 'real' as const, projectId: input.projectId }
      const document = row.formatFamily === 'A' ? decodePayrollARead<PayrollAOutputRead>(output, 'output', q, row.id).document : row.formatFamily === 'C1' ? decodePayrollC1Read<PayrollC1OutputRead>(output, 'output', q, row.id).document : row.formatFamily === 'C2' ? decodePayrollC2Read<PayrollC2OutputRead>(output, 'output', q, row.id).document : null
      if (!document || document.projectId !== input.projectId || row.status !== 'released' || row.projectId !== input.projectId || row.hidden || row.deletedAt || document.month !== row.month || document.formatFamily !== row.formatFamily || group.key !== (input.mode === 'project-month' ? row.month : payrollWorkbookSubjectKey(row)))
        invalid()
      seen.add(row.id)
      return { row, document }
    })
    if (!object(group.actualLedger) || !object(group.actualLedger.scope) || !Array.isArray(group.actualLedger.scope.originalStatementIds))
      invalid()
    const scope = group.actualLedger.scope
    if (scope.projectId !== input.projectId || !Array.isArray(scope.originalStatementIds) || scope.originalStatementIds.some(id => !selected.has(String(id))))
      invalid()
    const actualLedger = decodePayrollAdjustmentRead<PayrollActualLedgerRead>(group.actualLedger, 'actual-ledger', { origin: 'real', projectId: input.projectId }, scope)
    const scopeIds = scope.originalStatementIds
    if (!scopeIds.length || entries.some(entry => !scopeIds.includes(entry.row.id)))
      invalid()
    for (const id of scopeIds) {
      if (typeof id !== 'string' || scopeSeen.has(id))
        invalid()
      scopeSeen.add(id)
    }
    return { key: group.key, label: group.label, entries, actualLedger }
  })
  for (const gap of raw.gaps) {
    if (!object(gap) || !exact(gap, ['statementId', 'month', 'formatFamily', 'reason']) || !selected.has(String(gap.statementId)) || seen.has(String(gap.statementId)) || ![gap.month, gap.formatFamily, gap.reason].every(workbookText))
      invalid()
    seen.add(String(gap.statementId))
  }
  if (seen.size !== selected.size || scopeSeen.size !== selected.size || (input.mode === 'leader-cycle' && groups.length !== 1) || raw.issues.some(issue => issue.projectId !== input.projectId || !selected.has(issue.statementId) || !groups.some(group => group.entries.some(entry => entry.row.id === issue.statementId && entry.document.formatFamily === issue.formatFamily))) || new Set(raw.issues.map(issue => issue.statementId)).size !== raw.issues.length)
    invalid()
  for (const gap of raw.deliveryGaps) {
    if (!object(gap) || !exact(gap, ['kind', 'statementId', 'reason']) || !['numbering', 'roster', 'actual'].includes(String(gap.kind)) || !(gap.statementId === null || selected.has(String(gap.statementId))) || !workbookText(gap.reason))
      invalid()
  }
  if (kind === 'preview') {
    if (!object(raw.eligibility) || !exact(raw.eligibility, ['canSave', 'reasons']) || typeof raw.eligibility.canSave !== 'boolean' || !Array.isArray(raw.eligibility.reasons) || !raw.eligibility.reasons.every(workbookText)
      || (raw.eligibility.canSave && (c.readonly || raw.eligibility.reasons.length || !groups.some(group => group.entries.length))) || !(raw.roster === null || object(raw.roster))) {
      invalid()
    }
    if (raw.roster !== null) {
      const r = raw.roster
      if (!object(r) || !exact(r, ['id', 'version', 'projectId', 'registeredOn', 'createdAt', 'statementIds', 'memberCount', 'gapCount']) || !object(raw.rosterRef)
        || r.id !== raw.rosterRef.id || r.id !== input.rosterArchiveId || r.projectId !== input.projectId || r.version !== raw.rosterRef.version || r.registeredOn !== raw.rosterRef.registeredOn || !timestamp(r.createdAt)
        || !Array.isArray(r.statementIds) || !same([...r.statementIds].sort(), input.statementIds) || !positive(r.memberCount) || !Number.isSafeInteger(r.gapCount) || Number(r.gapCount) < 0) {
        invalid()
      }
    }
    else if (raw.rosterRef !== null || input.rosterArchiveId !== null) {
      invalid()
    }
  }
  else if (raw.schemaVersion !== 1 || !('archiveId' in target) || raw.id !== target.archiveId || !isStableRouteIdentity(raw.id) || !positive(raw.version) || !timestamp(raw.createdAt) || !isStableRouteIdentity(raw.createdBy)
    || !sha(raw.manifestHash) || raw.completeness !== (raw.gaps.length || raw.deliveryGaps.length ? 'partial' : 'complete')) {
    invalid()
  }
  if ((raw.rosterRef === null) !== (input.rosterArchiveId === null) || (object(raw.rosterRef) && raw.rosterRef.id !== input.rosterArchiveId))
    invalid()
  return { ...raw, input, groups } as unknown as T
}
export function decodePayrollWorkbookResult(value: unknown, commandId?: string): PayrollWorkbookResult {
  if (!object(value) || !exact(value, ['commandId', 'archiveId', 'version', 'manifestHash']) || ![value.commandId, value.archiveId].every(isStableRouteIdentity) || (commandId && value.commandId !== commandId) || !positive(value.version) || !sha(value.manifestHash))
    invalid()
  return value as unknown as PayrollWorkbookResult
}
export function decodePayrollWorkbookSummaries(value: unknown, projectId: string): PayrollWorkbookArchiveSummary[] {
  if (!Array.isArray(value))
    invalid()
  const ids = new Set<string>()
  for (const row of value) {
    if (!object(row) || !exact(row, ['id', 'version', 'mode', 'projectId', 'statementIds', 'createdAt', 'completeness', 'rosterRef']) || !isStableRouteIdentity(row.id) || !positive(row.version) || row.projectId !== projectId
      || ids.has(String(row.id)) || !timestamp(row.createdAt) || !['complete', 'partial'].includes(String(row.completeness)) || !rosterRef(row.rosterRef)) {
      invalid()
    }
    ids.add(String(row.id))
    parsePayrollWorkbookInput({ projectId, mode: row.mode, statementIds: row.statementIds, rosterArchiveId: null })
  }
  return value as PayrollWorkbookArchiveSummary[]
}
