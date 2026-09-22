import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { isStableRouteIdentity } from '../../../../app/lib/util/stable-route-identity'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const { planId, ...query } = getQuery(event)
    if (!isStableRouteIdentity(planId))
      throw payrollProblem('invalid-query', '批量工资计划编号无效')
    return await payrollService.batch(parsePayrollQuery(query), planId, getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwQuantityError(cause) }
})
