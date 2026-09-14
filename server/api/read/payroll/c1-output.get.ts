import { encodePayrollC1Wire } from '../../../../app/lib/payroll/central-c1-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { isStableRouteIdentity } from '../../../../app/lib/util/stable-route-identity'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const { statementId, ...query } = getQuery(event)
    if (!isStableRouteIdentity(statementId))
      throw payrollProblem('invalid-query', 'C1 输出缺少原单据身份')
    return encodePayrollC1Wire(await payrollService.c1Output(parsePayrollQuery(query), statementId, getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
