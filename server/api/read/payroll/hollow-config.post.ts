import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { decodePayrollHollowWire, encodePayrollHollowWire } from '../../../../app/lib/payroll/central-hollow-deduction-codec'
import { hollowDeductionKeys, isPayrollHollowConfigQuery } from '../../../../app/lib/payroll/central-hollow-deduction-validation'
import { payrollServiceForEvent } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    const body: unknown = await readBody(event)
    if (!hollowDeductionKeys(body, ['query', 'config']) || !body.query || typeof body.query !== 'object' || Array.isArray(body.query))
      throw payrollProblem('invalid-query', '空鼓配置请求必须包含原查询和固定配置范围')
    const config = decodePayrollHollowWire(body.config)
    if (!isPayrollHollowConfigQuery(config))
      throw payrollProblem('invalid-query', '空鼓配置主体、项目或月份不完整')
    return encodePayrollHollowWire(await payrollService.hollowConfig(parsePayrollQuery(body.query as Record<string, unknown>), config, getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) {
    throwQuantityError(cause)
  }
})
