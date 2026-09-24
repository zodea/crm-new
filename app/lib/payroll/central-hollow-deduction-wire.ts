import { hollowDeductionFail } from './central-hollow-deduction-validation'
import { payrollFixedDecimal, wireNumber, wireObject, wireText } from './central-payroll-wire'
import { amountInCents } from './statements'

/** 仅已定数值字段使用十进制传输；处数仍是安全整数，原JSON字符串不重写。 */
export function transformPayrollHollowWire(value: unknown, decode: boolean): unknown {
  if (Array.isArray(value))
    return value.map(child => transformPayrollHollowWire(child, decode))
  if (!wireObject(value))
    return value
  const amountObject = Object.hasOwn(value, 'state') && Object.hasOwn(value, 'knownValue')
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const money = key === 'amount' || (amountObject && (key === 'value' || key === 'knownValue'))
    const decimal = key === 'unitAmount'
    if ((!money && !decimal) || wireObject(child))
      return [key, transformPayrollHollowWire(child, decode)]
    if (child === null)
      return [key, null]
    if (decode) {
      if (!wireText(child) || !(money ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(child) || !Number.isFinite(Number(child)))
        hollowDeductionFail('空鼓扣款金额或单处价格的传输格式无效')
      const parsed = Number(child)
      if (money && !Number.isSafeInteger(amountInCents(parsed)))
        hollowDeductionFail('空鼓扣款金额超出可准确核对范围')
      return [key, parsed]
    }
    if (!wireNumber(child) || (money && (!Number.isSafeInteger(amountInCents(child)) || Math.abs(child * 100 - amountInCents(child)) > 1e-8)))
      hollowDeductionFail('空鼓扣款须精确到分，单处价格须为有限数值或明确空值')
    return [key, money ? child.toFixed(2) : payrollFixedDecimal(child)]
  }))
}
export const encodePayrollHollowWire = (value: unknown) => transformPayrollHollowWire(value, false)
export const decodePayrollHollowWire = (value: unknown) => transformPayrollHollowWire(value, true)
