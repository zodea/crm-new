import { encodePayrollAWire, parsePayrollAFormInput } from '../../../../app/lib/payroll/central-a-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollObject } from '../../../../app/lib/payroll/central-snapshot'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!payrollObject(body) || !payrollObject(body.query) || Object.keys(body).some(key => !['query', 'input'].includes(key)))
      throw payrollProblem('invalid-query', '工资预览请求无效')
    return encodePayrollAWire(await payrollService.aForm(parsePayrollQuery(body.query), parsePayrollAFormInput(body.input), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
