import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { encodePayrollDayworkWire, parsePayrollDayworkScope } from '../../../../app/lib/payroll/central-daywork-codec'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const { scope, ...query } = getQuery(event)
    if (typeof scope !== 'string')
      throw payrollProblem('invalid-query', '签工缺少固定范围')
    let parsed: unknown
    try {
      parsed = JSON.parse(scope)
    }
    catch { throw payrollProblem('invalid-query', '签工范围格式无效') }
    return encodePayrollDayworkWire(await payrollService.dayworkList(parsePayrollQuery(query), parsePayrollDayworkScope(parsed), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
