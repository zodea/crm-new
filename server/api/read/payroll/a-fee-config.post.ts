import { encodePayrollAFeesWire, parsePayrollAFeeConfigScope } from '../../../../app/lib/payroll/central-a-fees-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollObject } from '../../../../app/lib/payroll/central-snapshot'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!payrollObject(body) || !payrollObject(body.query) || Object.keys(body).some(key => !['query', 'scope'].includes(key)))
      throw payrollProblem('invalid-query', '费用配置请求无效')
    return encodePayrollAFeesWire(await payrollService.aFeeConfig(parsePayrollQuery(body.query), parsePayrollAFeeConfigScope(body.scope), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
