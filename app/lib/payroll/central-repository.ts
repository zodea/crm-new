import type { ProjectHttpFetcher } from '../project/http-repository'
import type { PayrollAConfigRead, PayrollAFormRead, PayrollAOutputRead } from './central-a-contract'
import type { PayrollDetailRead, PayrollListRead, PayrollRepository, PayrollSourcesRead } from './central-contract'
import { readProjectHttp } from '../project/http-repository'
import { decodePayrollARead, decodePayrollAResult, encodePayrollAWire } from './central-a-codec'
import { decodePayrollRead } from './central-codec'

export function createPayrollRepository(fetcher: ProjectHttpFetcher): PayrollRepository {
  return {
    aForm: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/a-form', { method: 'POST', body: { query, input: encodePayrollAWire(input) } }), value => decodePayrollARead<PayrollAFormRead>(value, 'form', query, input)),
    aConfig: (query, scope) => readProjectHttp(() => fetcher('/api/read/payroll/a-config', { query: { ...query, scope: JSON.stringify(scope) } }), value => decodePayrollARead<PayrollAConfigRead>(value, 'config', query, scope)),
    aOutput: (query, id) => readProjectHttp(() => fetcher('/api/read/payroll/a-output', { query: { ...query, statementId: id } }), value => decodePayrollARead<PayrollAOutputRead>(value, 'output', query, id)),
    execute: command => readProjectHttp(() => fetcher('/api/commands/payroll-a', { method: 'POST', body: encodePayrollAWire(command) as Record<string, unknown> }), value => decodePayrollAResult(value, command)),
    list: query => readProjectHttp(() => fetcher('/api/read/payroll', { query: { ...query } }), value => decodePayrollRead<PayrollListRead>(value, 'list', query)),
    detail: (query, id) => readProjectHttp(() => fetcher(`/api/read/payroll/${encodeURIComponent(id)}`, { query: { ...query } }), value => decodePayrollRead<PayrollDetailRead>(value, 'detail', query, id)),
    sources: query => readProjectHttp(() => fetcher('/api/read/payroll/sources', { query: { ...query } }), value => decodePayrollRead<PayrollSourcesRead>(value, 'sources', query)),
  }
}
