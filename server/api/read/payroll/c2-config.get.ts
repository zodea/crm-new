import { encodePayrollC2Wire, parsePayrollC2ConfigScope } from '../../../../app/lib/payroll/central-c2-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollServiceForEvent } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    const { scope, ...query } = getQuery(event)
    if (typeof scope !== 'string')
      throw payrollProblem('invalid-query', 'C2 配置缺少固定范围')
    let parsed: unknown
    try {
      parsed = JSON.parse(scope)
    }
    catch { throw payrollProblem('invalid-query', 'C2 配置范围格式无效') }
    return encodePayrollC2Wire(await payrollService.c2Config(parsePayrollQuery(query), parsePayrollC2ConfigScope(parsed), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
