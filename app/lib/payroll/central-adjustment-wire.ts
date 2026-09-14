import type { PayrollActualPaymentFormInput, PayrollActualReversalFormInput, PayrollActualScope } from './central-actual-contract'
import type { PayrollAdjustmentCommand, PayrollAdjustmentFormInput } from './central-adjustment-contract'
import { assertPayrollActualCommand, assertPayrollActualDraft, assertPayrollActualTarget } from './central-actual-validation'
import { assertPayrollAdjustmentCommand, assertPayrollAdjustmentDraft, assertPayrollAdjustmentTarget } from './central-adjustment-validation'
import { payrollProblem } from './central-contract'
import { payrollFixedDecimal, wireCent, wireExact, wireId, wireObject, wireText } from './central-payroll-wire'
import { assertPayrollReversalCommand, assertPayrollReversalDraft, assertPayrollReversalTarget } from './central-reversal-validation'

const moneyKeys = new Set(['amount', 'delta', 'remainingAmount', 'embeddedInCalculation', 'additionalWithholding'])
const decimalKeys = new Set(['quantity', 'knownQuantity', 'fieldQty', 'unitPrice', 'unitRate', 'payRatio', 'dailyWage', 'overtimeRate', 'hours', 'overtimeHours', 'laborUnits'])
function transform(v: unknown, decode: boolean): unknown {
  if (Array.isArray(v))
    return v.map(child => transform(child, decode))
  if (!wireObject(v))
    return v
  const metric = 'knownValue' in v && 'state' in v
  const dimension = 'dimension' in v && ['quantity', 'unit-price', 'pay-ratio'].includes(String(v.dimension))
  return Object.fromEntries(Object.entries(v).filter(([, child]) => child !== undefined).map(([key, child]) => {
    const money = moneyKeys.has(key) || (metric && ['value', 'knownValue'].includes(key))
    const decimal = decimalKeys.has(key) || (dimension && ['before', 'after', 'current', 'effective'].includes(key))
    if ((!money && !decimal) || wireObject(child) || Array.isArray(child))
      return [key, transform(child, decode)]
    if (child === null)
      return [key, null]
    if (decode) {
      if (!wireText(child) || !(money ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(child) || !Number.isFinite(Number(child)) || (money && !wireCent(Math.abs(Number(child)))))
        throw payrollProblem('validation-failed', '工资更正金额须使用有符号到分数值，量价须使用明确十进制')
      return [key, Number(child)]
    }
    if (typeof child !== 'number' || !Number.isFinite(child) || (money && !wireCent(Math.abs(child))))
      throw payrollProblem('validation-failed', '工资更正数值不完整或金额未精确到分')
    return [key, money ? child.toFixed(2) : payrollFixedDecimal(child)]
  }))
}
export const encodePayrollAdjustmentWire = (v: unknown) => transform(v, false)
export const decodePayrollAdjustmentWire = (v: unknown) => transform(v, true)
export function parsePayrollAdjustmentCommand(raw: unknown): PayrollAdjustmentCommand {
  const v = transform(raw, true)
  if (wireObject(v) && wireObject(v.action) && v.action.kind === 'confirm-actual-payment')
    assertPayrollActualCommand(v)
  else if (wireObject(v) && wireObject(v.action) && v.action.kind === 'confirm-recording-reversal')
    assertPayrollReversalCommand(v)
  else assertPayrollAdjustmentCommand(v)
  return v
}
export function parsePayrollAdjustmentFormInput(raw: unknown): PayrollAdjustmentFormInput {
  const v = transform(raw, true)
  wireExact(v, ['target', 'draft'])
  assertPayrollAdjustmentTarget(v.target)
  if (v.draft !== undefined)
    assertPayrollAdjustmentDraft(v.draft)
  return v as unknown as PayrollAdjustmentFormInput
}
export function parsePayrollActualPaymentFormInput(raw: unknown): PayrollActualPaymentFormInput {
  const v = transform(raw, true)
  wireExact(v, ['target', 'draft'])
  assertPayrollActualTarget(v.target)
  if (v.draft !== undefined)
    assertPayrollActualDraft(v.draft)
  return v as unknown as PayrollActualPaymentFormInput
}
export function parsePayrollActualReversalFormInput(raw: unknown): PayrollActualReversalFormInput {
  const v = transform(raw, true)
  wireExact(v, ['target', 'draft'])
  assertPayrollReversalTarget(v.target)
  if (v.draft !== undefined)
    assertPayrollReversalDraft(v.draft)
  return v as unknown as PayrollActualReversalFormInput
}
export function parsePayrollActualScope(v: unknown): PayrollActualScope {
  wireExact(v, ['projectId', 'originalStatementIds'])
  if (!wireId(v.projectId) || (v.originalStatementIds !== undefined && (!Array.isArray(v.originalStatementIds) || !v.originalStatementIds.every(wireId) || new Set(v.originalStatementIds).size !== v.originalStatementIds.length)))
    throw payrollProblem('invalid-query', '工资实际收付须指定项目和不重复的原工资范围')
  return v as unknown as PayrollActualScope
}
