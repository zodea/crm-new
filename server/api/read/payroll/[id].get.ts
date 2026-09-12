import { encodePayrollWire, parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { isStableRouteIdentity } from '../../../../app/lib/util/stable-route-identity'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id')
    if (!isStableRouteIdentity(id))
      throw payrollProblem('invalid-query', '工资单身份无效')
    return encodePayrollWire(await payrollService.detail(parsePayrollQuery(getQuery(event)), id!, getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
