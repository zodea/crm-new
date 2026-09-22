import { parsePayrollHollowCommand } from '../../../app/lib/payroll/central-hollow-deduction-codec'
import { payrollService } from '../../utils/payroll-runtime'
import { throwQuantityError } from '../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    return await payrollService.executeHollow(parsePayrollHollowCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
