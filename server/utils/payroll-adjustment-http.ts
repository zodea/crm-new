import type { PayrollAdjustmentReadKind } from '../../app/lib/payroll/central-adjustment-read-codec'
import { encodePayrollAdjustmentWire, parsePayrollActualPaymentFormInput, parsePayrollActualReversalFormInput, parsePayrollActualScope, parsePayrollAdjustmentFormInput } from '../../app/lib/payroll/central-adjustment-wire'
import { parsePayrollQuery } from '../../app/lib/payroll/central-codec'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { wireExact, wireId } from '../../app/lib/payroll/central-payroll-wire'
import { payrollServiceForEvent } from './payroll-runtime'
import { throwQuantityError } from './quantity-error'

/** 每个路由固定读取种类；客户端不能选择服务方法或提供另一种写动作。 */
export function payrollAdjustmentReadHandler(kind: PayrollAdjustmentReadKind) {
  return defineEventHandler(async (event) => {
    try {
      const payrollService = payrollServiceForEvent(event)
      const body: unknown = await readBody(event)
      wireExact(body, ['query', 'input'])
      wireExact(body.query, ['origin', 'includeDemo', 'projectId', 'crewId', 'month'])
      const query = parsePayrollQuery(body.query)
      const sessionId = getHeader(event, 'x-ruihang-test-session')
      let result
      if (kind === 'adjustment-form') {
        result = await payrollService.adjustmentForm(query, parsePayrollAdjustmentFormInput(body.input), sessionId)
      }
      else if (kind === 'actual-payment-form') {
        result = await payrollService.actualPaymentForm(query, parsePayrollActualPaymentFormInput(body.input), sessionId)
      }
      else if (kind === 'actual-reversal-form') {
        result = await payrollService.actualReversalForm(query, parsePayrollActualReversalFormInput(body.input), sessionId)
      }
      else if (kind === 'actual-ledger') {
        result = await payrollService.actualLedger(query, parsePayrollActualScope(body.input), sessionId)
      }
      else if (kind === 'adjustment-history') {
        wireExact(body.input, ['statementId'])
        if (!wireId(body.input.statementId))
          throw payrollProblem('invalid-query', '缺少原工资身份')
        result = await payrollService.adjustmentHistory(query, body.input.statementId, sessionId)
      }
      else if (kind === 'adjustment-detail') {
        wireExact(body.input, ['adjustmentId'])
        if (!wireId(body.input.adjustmentId))
          throw payrollProblem('invalid-query', '缺少原更正身份')
        result = await payrollService.adjustmentDetail(query, body.input.adjustmentId, sessionId)
      }
      else if (kind === 'actual-payment-detail') {
        wireExact(body.input, ['eventId'])
        if (!wireId(body.input.eventId))
          throw payrollProblem('invalid-query', '缺少原实际收付身份')
        result = await payrollService.actualPaymentDetail(query, body.input.eventId, sessionId)
      }
      else {
        wireExact(body.input, ['statementId'])
        if (!wireId(body.input.statementId))
          throw payrollProblem('invalid-query', '缺少本次发放工资身份')
        result = await payrollService.releaseAdjustmentPreview(query, { statementId: body.input.statementId }, sessionId)
      }
      return encodePayrollAdjustmentWire(result)
    }
    catch (cause) { throwQuantityError(cause) }
  })
}
