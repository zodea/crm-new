import { encodePayrollWire, parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollService } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const query = parsePayrollQuery(getQuery(event))
    if (!query.projectId)
      throw payrollProblem('invalid-query', '请选择要核对的工资来源项目')
    return encodePayrollWire(await payrollService.sources({ ...query, projectId: query.projectId }, getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
