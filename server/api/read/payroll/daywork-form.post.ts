import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { encodePayrollDayworkWire, parsePayrollDayworkFormInput } from '../../../../app/lib/payroll/central-daywork-codec'
import { payrollObject } from '../../../../app/lib/payroll/central-snapshot'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!payrollObject(body) || !payrollObject(body.query) || Object.keys(body).some(k => !['query', 'input'].includes(k)))
      throw payrollProblem('invalid-query', '签工预览请求无效')
    return encodePayrollDayworkWire(await payrollService.dayworkForm(parsePayrollQuery(body.query), parsePayrollDayworkFormInput(body.input), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
