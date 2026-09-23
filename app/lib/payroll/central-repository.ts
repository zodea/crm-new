import type { ProjectHttpFetcher } from '../project/http-repository'
import type { PayrollAConfigRead, PayrollAFormRead, PayrollAOutputRead } from './central-a-contract'
import type { PayrollARoundingRead } from './central-a-rounding-contract'
import type { PayrollAdjustmentRead, PayrollAdjustmentReadKind } from './central-adjustment-read-codec'
import type { PayrollC1ConfigRead, PayrollC1FormRead, PayrollC1OutputRead } from './central-c1-contract'
import type { PayrollC2ConfigRead, PayrollC2FormRead, PayrollC2OutputRead } from './central-c2-contract'
import type { PayrollDetailRead, PayrollListRead, PayrollQuery, PayrollRepository, PayrollSourcesRead } from './central-contract'
import type { PayrollDayworkFormRead, PayrollDayworkListRead } from './central-daywork-contract'
import { readProjectHttp } from '../project/http-repository'
import { decodePayrollARead, decodePayrollAResult, encodePayrollAWire } from './central-a-codec'
import { decodePayrollAFeeConfigRead, decodePayrollAFeesResult, encodePayrollAFeesWire } from './central-a-fees-codec'
import { decodePayrollARoundingRead, decodePayrollARoundingResult } from './central-a-rounding-codec'
import { decodePayrollAdjustmentResult } from './central-adjustment-codec'
import { decodePayrollAdjustmentRead } from './central-adjustment-read-codec'
import { encodePayrollAdjustmentWire } from './central-adjustment-wire'
import { decodePayrollAttendanceRead, decodePayrollAttendanceResult, encodePayrollAttendanceWire } from './central-attendance-codec'
import { decodePayrollBatchPlan, decodePayrollBatchPreview } from './central-batch-codec'
import { decodePayrollC1Read, decodePayrollC1Result, encodePayrollC1Wire } from './central-c1-codec'
import { decodePayrollC2Read, decodePayrollC2Result, encodePayrollC2Wire } from './central-c2-codec'
import { decodePayrollRead } from './central-codec'
import { decodePayrollDayworkRead, decodePayrollDayworkResult, encodePayrollDayworkWire } from './central-daywork-codec'
import { decodePayrollHollowConfigRead, decodePayrollHollowResult, encodePayrollHollowWire } from './central-hollow-deduction-codec'
import { decodePayrollNumberingRead, decodePayrollNumberingResult } from './central-numbering-codec'

import { createPayrollWorkbookRepository } from './workbook-repository'

export function createPayrollRepository(fetcher: ProjectHttpFetcher): PayrollRepository {
  const adjustmentRead = <T extends PayrollAdjustmentRead>(kind: PayrollAdjustmentReadKind, query: PayrollQuery, input: unknown, target = input): Promise<T> => readProjectHttp(() => fetcher(`/api/read/payroll/${kind}`, { method: 'POST', body: { query, input: encodePayrollAdjustmentWire(input) } }), value => decodePayrollAdjustmentRead<T>(value, kind, query, target))
  return {
    ...createPayrollWorkbookRepository(fetcher),
    numbering: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/numbering', { method: 'POST', body: { query, input } }), value => decodePayrollNumberingRead(value, query, input)),
    executeNumbering: command => readProjectHttp(() => fetcher('/api/commands/payroll-numbering', { method: 'POST', body: command as unknown as Record<string, unknown> }), value => decodePayrollNumberingResult(value, command)),
    batchPreview: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/batch-preview', { method: 'POST', body: { query, input } }), value => decodePayrollBatchPreview(value, query, input)),
    executeBatch: command => readProjectHttp(() => fetcher('/api/commands/payroll-batch', { method: 'POST', body: command as unknown as Record<string, unknown> }), value => decodePayrollBatchPlan(value, command.action.kind === 'confirm-batch' ? { origin: command.origin, projectId: command.action.input.projectId, month: command.action.input.month } : { origin: command.origin }, command.action.kind === 'confirm-batch' ? undefined : command.action.input.planId, command)),
    batch: (query, planId) => readProjectHttp(() => fetcher('/api/read/payroll/batch', { query: { ...query, planId } }), value => decodePayrollBatchPlan(value, query, planId)),
    aRounding: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/a-rounding', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollARoundingRead(value, query, scope) as PayrollARoundingRead),
    executeARounding: command => readProjectHttp(() => fetcher('/api/commands/payroll-a-rounding', { method: 'POST', body: command as unknown as Record<string, unknown> }), value => decodePayrollARoundingResult(value, command)),
    hollowConfig: (query, config) => readProjectHttp(() => fetcher('/api/read/payroll/hollow-config', { method: 'POST', body: { query, config: encodePayrollHollowWire(config) } }), value => decodePayrollHollowConfigRead(value, query, config)),
    executeHollow: command => readProjectHttp(() => fetcher('/api/commands/payroll-hollow', { method: 'POST', body: encodePayrollHollowWire(command) as Record<string, unknown> }), value => decodePayrollHollowResult(value, command)),
    aFeeConfig: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/a-fee-config', { method: 'POST', body: { query, scope: encodePayrollAFeesWire(scope) } }), value => decodePayrollAFeeConfigRead(value, query, scope)),
    executeFees: command => readProjectHttp(() => fetcher('/api/commands/payroll-a-fees', { method: 'POST', body: encodePayrollAFeesWire(command) as Record<string, unknown> }), value => decodePayrollAFeesResult(value, command)),
    adjustmentHistory: (q, id) => adjustmentRead('adjustment-history', q, { statementId: id }, id),
    adjustmentForm: (q, input) => adjustmentRead('adjustment-form', q, input),
    adjustmentDetail: (q, id) => adjustmentRead('adjustment-detail', q, { adjustmentId: id }, id),
    actualPaymentForm: (q, input) => adjustmentRead('actual-payment-form', q, input),
    actualPaymentDetail: (q, id) => adjustmentRead('actual-payment-detail', q, { eventId: id }, id),
    actualReversalForm: (q, input) => adjustmentRead('actual-reversal-form', q, input),
    actualLedger: (q, scope) => adjustmentRead('actual-ledger', q, scope),
    releaseAdjustmentPreview: (q, input) => adjustmentRead('release-adjustments', q, input),
    executeAdjustment: command => readProjectHttp(() => fetcher('/api/commands/payroll-adjustment', { method: 'POST', body: encodePayrollAdjustmentWire(command) as Record<string, unknown> }), value => decodePayrollAdjustmentResult(value, command)),
    dayworkList: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/daywork', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollDayworkRead<PayrollDayworkListRead>(value, 'list', query, scope)),
    dayworkForm: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/daywork-form', { method: 'POST', body: { query, input: encodePayrollDayworkWire(input) } }), value => decodePayrollDayworkRead<PayrollDayworkFormRead>(value, 'form', query, input)),
    executeDaywork: command => readProjectHttp(() => fetcher('/api/commands/payroll-daywork', { method: 'POST', body: encodePayrollDayworkWire(command) as Record<string, unknown> }), value => decodePayrollDayworkResult(value, command)),
    c2Form: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/c2-form', { method: 'POST', body: { query, input: encodePayrollC2Wire(input) } }), value => decodePayrollC2Read<PayrollC2FormRead>(value, 'form', query, input)),
    c2Config: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/c2-config', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollC2Read<PayrollC2ConfigRead>(value, 'config', query, scope)),
    c2Output: (query, id) => readProjectHttp(() => fetcher('/api/read/payroll/c2-output', { query: { ...query, statementId: id } }), value => decodePayrollC2Read<PayrollC2OutputRead>(value, 'output', query, id)),
    executeC2: command => readProjectHttp(() => fetcher('/api/commands/payroll-c2', { method: 'POST', body: encodePayrollC2Wire(command) as Record<string, unknown> }), value => decodePayrollC2Result(value, command)),
    attendanceMatrix: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/attendance', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollAttendanceRead(value, query, scope)),
    executeAttendance: command => readProjectHttp(() => fetcher('/api/commands/payroll-attendance', { method: 'POST', body: encodePayrollAttendanceWire(command) as Record<string, unknown> }), value => decodePayrollAttendanceResult(value, command)),
    c1Form: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/c1-form', { method: 'POST', body: { query, input: encodePayrollC1Wire(input) } }), value => decodePayrollC1Read<PayrollC1FormRead>(value, 'form', query, input)),
    c1Config: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/c1-config', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollC1Read<PayrollC1ConfigRead>(value, 'config', query, scope)),
    c1Output: (query, id) => readProjectHttp(() => fetcher('/api/read/payroll/c1-output', { query: { ...query, statementId: id } }), value => decodePayrollC1Read<PayrollC1OutputRead>(value, 'output', query, id)),
    executeC1: command => readProjectHttp(() => fetcher('/api/commands/payroll-c1', { method: 'POST', body: encodePayrollC1Wire(command) as Record<string, unknown> }), value => decodePayrollC1Result(value, command)),
    aForm: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/a-form', { method: 'POST', body: { query, input: encodePayrollAWire(input) } }), value => decodePayrollARead<PayrollAFormRead>(value, 'form', query, input)),
    aConfig: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/a-config', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollARead<PayrollAConfigRead>(value, 'config', query, scope)),
    aOutput: (query, id) => readProjectHttp(() => fetcher('/api/read/payroll/a-output', { query: { ...query, statementId: id } }), value => decodePayrollARead<PayrollAOutputRead>(value, 'output', query, id)),
    execute: command => readProjectHttp(() => fetcher('/api/commands/payroll-a', { method: 'POST', body: encodePayrollAWire(command) as Record<string, unknown> }), value => decodePayrollAResult(value, command)),
    list: query => readProjectHttp(() => fetcher('/api/read/payroll', { query: { ...query } }), value => decodePayrollRead<PayrollListRead>(value, 'list', query)),
    detail: (query, id) => readProjectHttp(() => fetcher(`/api/read/payroll/${encodeURIComponent(id)}`, { query: { ...query } }), value => decodePayrollRead<PayrollDetailRead>(value, 'detail', query, id)),
    sources: query => readProjectHttp(() => fetcher('/api/read/payroll/sources', { query: { ...query } }), value => decodePayrollRead<PayrollSourcesRead>(value, 'sources', query)),
  }
}
