import type { ProjectHttpFetcher } from '../project/http-repository'
import type { PayrollAConfigRead, PayrollAFormRead, PayrollAOutputRead } from './central-a-contract'
import type { PayrollC1ConfigRead, PayrollC1FormRead, PayrollC1OutputRead } from './central-c1-contract'
import type { PayrollDetailRead, PayrollListRead, PayrollRepository, PayrollSourcesRead } from './central-contract'
import { readProjectHttp } from '../project/http-repository'
import { decodePayrollARead, decodePayrollAResult, encodePayrollAWire } from './central-a-codec'
import { decodePayrollAttendanceRead, decodePayrollAttendanceResult, encodePayrollAttendanceWire } from './central-attendance-codec'
import { decodePayrollC1Read, decodePayrollC1Result, encodePayrollC1Wire } from './central-c1-codec'
import { decodePayrollRead } from './central-codec'

export function createPayrollRepository(fetcher: ProjectHttpFetcher): PayrollRepository {
  return {
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
