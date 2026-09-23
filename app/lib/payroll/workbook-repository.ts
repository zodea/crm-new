import type { ProjectHttpFetcher } from '../project/http-repository'
import type { PayrollWorkbookRepository } from './central-workbook-contract'
import { readProjectHttp } from '../project/http-repository'
import { payrollProblem } from './central-contract'
import { numberingExact, numberingObject } from './central-numbering-codec'
import { decodePayrollWorkbookRead, decodePayrollWorkbookResult, decodePayrollWorkbookSummaries } from './workbook-codec'

export function createPayrollWorkbookRepository(fetcher: ProjectHttpFetcher): PayrollWorkbookRepository {
  return {
    workbookPreview: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/workbook-preview', { method: 'POST', body: { query, input } }), value => decodePayrollWorkbookRead(value, 'preview', query, input)),
    workbookArchive: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/workbook-archive', { method: 'POST', body: { query, input } }), value => decodePayrollWorkbookRead(value, 'archive', query, input)),
    workbookArchives: (query, input) => readProjectHttp(() => fetcher('/api/read/payroll/workbook-archives', { method: 'POST', body: { query, input } }), value => decodePayrollWorkbookSummaries(value, input.projectId)),
    executeWorkbook: command => readProjectHttp(() => fetcher('/api/commands/payroll-workbook', { method: 'POST', body: { ...command } }), value => decodePayrollWorkbookResult(value, command.commandId)),
    resolveWorkbook: (commandId, projectId) => readProjectHttp(() => fetcher('/api/commands/payroll-workbook-resolve', { method: 'POST', body: { commandId, projectId } }), (value) => {
      if (numberingObject(value) && value.state === 'not-applied' && numberingExact(value, ['state']))
        return { state: 'not-applied' }
      if (numberingObject(value) && value.state === 'applied' && numberingExact(value, ['state', 'result']))
        return { state: 'applied', result: decodePayrollWorkbookResult(value.result, commandId) }
      throw payrollProblem('unavailable', '原目录提交结果无法确认')
    }),
  }
}
