import type { ProjectHttpFetcher } from '../project/http-repository'
import type { PayrollDetailRead, PayrollListRead, PayrollRepository, PayrollSourcesRead } from './central-contract'
import { readProjectHttp } from '../project/http-repository'
import { decodePayrollRead } from './central-codec'

export function createPayrollRepository(fetcher: ProjectHttpFetcher): PayrollRepository {
  return {
    list: query => readProjectHttp(() => fetcher('/api/read/payroll', { query: { ...query } }), value => decodePayrollRead<PayrollListRead>(value, 'list', query)),
    detail: (query, id) => readProjectHttp(() => fetcher(`/api/read/payroll/${encodeURIComponent(id)}`, { query: { ...query } }), value => decodePayrollRead<PayrollDetailRead>(value, 'detail', query, id)),
    sources: query => readProjectHttp(() => fetcher('/api/read/payroll/sources', { query: { ...query } }), value => decodePayrollRead<PayrollSourcesRead>(value, 'sources', query)),
  }
}
