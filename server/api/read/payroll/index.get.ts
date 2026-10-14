import { encodePayrollWire, parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollDemoContext, payrollServiceForEvent } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    const query = parsePayrollQuery(getQuery(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return encodePayrollWire(query.origin === 'demo' ? payrollDemoContext(Boolean(query.includeDemo), sessionId) : await payrollService.list(query, sessionId))
  }
  catch (cause) { throwQuantityError(cause) }
})
