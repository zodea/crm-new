import { encodePayrollAttendanceWire, parsePayrollAttendanceScope } from '../../../../app/lib/payroll/central-attendance-codec'
import { parsePayrollQuery } from '../../../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../../../app/lib/payroll/central-contract'
import { payrollServiceForEvent } from '../../../utils/payroll-runtime'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const payrollService = payrollServiceForEvent(event)
    const { scope, ...query } = getQuery(event)
    if (typeof scope !== 'string')
      throw payrollProblem('invalid-query', '考勤缺少固定范围')
    let parsed: unknown
    try {
      parsed = JSON.parse(scope)
    }
    catch { throw payrollProblem('invalid-query', '考勤范围格式无效') }
    return encodePayrollAttendanceWire(await payrollService.attendanceMatrix(parsePayrollQuery(query), parsePayrollAttendanceScope(parsed), getHeader(event, 'x-ruihang-test-session')))
  }
  catch (cause) { throwQuantityError(cause) }
})
