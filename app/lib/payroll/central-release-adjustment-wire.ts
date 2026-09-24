import type { PayrollReleaseAdjustmentApplication } from './central-release-adjustment-contract'
import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollProblem } from './central-contract'
import { payrollObject } from './central-snapshot'
import { amountInCents } from './statements'

export function isPayrollReleaseApplications(value: unknown): value is PayrollReleaseAdjustmentApplication[] {
  return Array.isArray(value) && value.every(row => payrollObject(row) && Object.keys(row).every(k => ['adjustmentId', 'amount', 'balanceVersion', 'coverageVersion'].includes(k)) && isStableRouteIdentity(row.adjustmentId) && typeof row.amount === 'number' && Number.isFinite(row.amount) && Number.isSafeInteger(amountInCents(row.amount)) && Math.abs(row.amount * 100 - amountInCents(row.amount)) < 1e-8 && row.amount !== 0 && typeof row.balanceVersion === 'string' && !!row.balanceVersion && typeof row.coverageVersion === 'string' && !!row.coverageVersion) && new Set(value.map(row => row.adjustmentId)).size === value.length
}
/** 仅新处理数组允许有符号金额；旧正文未包含此字段时不会补空数组。 */
export function transformPayrollReleaseApplications(value: unknown, decode: boolean): unknown {
  if (!Array.isArray(value))
    throw payrollProblem('validation-failed', '工资处理引用须为明确数组')
  const result = value.map((row) => {
    if (!payrollObject(row))
      throw payrollProblem('validation-failed', '工资处理引用不完整')
    if (decode) {
      if (typeof row.amount !== 'string' || !/^-?(?:0|[1-9]\d*)\.\d{2}$/.test(row.amount))
        throw payrollProblem('validation-failed', '处理金额须使用到分十进制传输')
      return { ...row, amount: Number(row.amount) }
    }
    return row
  })
  if (!isPayrollReleaseApplications(result))
    throw payrollProblem('validation-failed', '处理引用、金额或采用版本无效')
  const applications: PayrollReleaseAdjustmentApplication[] = result
  return decode ? applications : applications.map(row => ({ ...row, amount: row.amount.toFixed(2) }))
}
