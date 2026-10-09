import { encodePayrollAWire } from '../../../../app/lib/payroll/central-a-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { isStableRouteIdentity } from '../../../../app/lib/util/stable-route-identity'
import { payrollServiceForEvent } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    const { statementId, ...query } = getQuery(event)
    if (!isStableRouteIdentity(statementId))
      throw payrollProblem('invalid-query', '工资输出缺少单据身份')
    return encodePayrollAWire(await payrollService.aOutput(parsePayrollQuery(query), statementId, getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
