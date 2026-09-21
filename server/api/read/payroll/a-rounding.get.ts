import { parsePayrollARoundingScope } from '../../../../app/lib/payroll/central-a-rounding-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const { scope, ...query } = getQuery(event)
    if (typeof scope !== 'string')
      throw payrollProblem('invalid-query', 'A 工资取整读取缺少固定范围')
    let parsed: unknown
    try {
      parsed = JSON.parse(scope)
    }
    catch { throw payrollProblem('invalid-query', 'A 工资取整范围格式无效') }
    return await payrollService.aRounding(parsePayrollQuery(query), parsePayrollARoundingScope(parsed), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
