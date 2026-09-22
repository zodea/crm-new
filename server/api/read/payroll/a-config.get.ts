import { encodePayrollAWire, parsePayrollAConfigScope } from '../../../../app/lib/payroll/central-a-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const { scope, ...query } = getQuery(event)
    if (typeof scope !== 'string')
      throw payrollProblem('invalid-query', '工资配置缺少固定范围')
    let value: unknown
    try {
      value = JSON.parse(scope)
    }
    catch { throw payrollProblem('invalid-query', '工资配置范围格式无效') }
    return encodePayrollAWire(await payrollService.aConfig(parsePayrollQuery(query), parsePayrollAConfigScope(value), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
