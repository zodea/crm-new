import { encodePayrollC1Wire, parsePayrollC1FormInput } from '../../../../app/lib/payroll/central-c1-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollObject } from '../../../../app/lib/payroll/central-snapshot'
import { payrollServiceForEvent } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    const body: unknown = await readBody(event)
    if (!payrollObject(body) || !payrollObject(body.query) || Object.keys(body).some(k => !['query', 'input'].includes(k)))
      throw payrollProblem('invalid-query', 'C1 预览请求无效')
    return encodePayrollC1Wire(await payrollService.c1Form(parsePayrollQuery(body.query), parsePayrollC1FormInput(body.input), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
