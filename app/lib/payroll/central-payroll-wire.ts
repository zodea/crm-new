import { isStableRouteIdentity } from '../util/stable-route-identity'
import { payrollProblem } from './central-contract'
import { payrollObject } from './central-snapshot'
import { amountInCents } from './statements'

export const wireObject = payrollObject
export const wireText = (v: unknown): v is string => typeof v === 'string'
export const wireNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const wireNullableText = (v: unknown) => v === null || wireText(v)
export const wireNullableNumber = (v: unknown) => v === null || wireNumber(v)
export const wireId = isStableRouteIdentity
export const wireArray = (v: unknown, test: (v: unknown) => boolean): v is unknown[] => Array.isArray(v) && v.every(test)
export const wireStrings = (v: unknown): v is string[] => wireArray(v, wireText)
export const wireFields = (v: Record<string, unknown>, names: string[], test: (v: unknown) => boolean) => names.every(name => test(v[name]))
export const wireMonth = (v: unknown): v is string => wireText(v) && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(v)
export const wireNonnegative = (v: unknown): v is number => wireNumber(v) && v >= 0
export const wireCent = (v: unknown): v is number => wireNonnegative(v) && Number.isSafeInteger(amountInCents(v)) && Math.abs(v * 100 - amountInCents(v)) < 1e-8
export function wireFail(message = '考勤或 C1 数据不完整'): never {
  throw payrollProblem('validation-failed', message)
}
export function wireExact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!payrollObject(v) || Object.keys(v).some(key => !keys.includes(key)))
    wireFail('请求包含不支持的字段')
}
export function wireDate(v: unknown): v is string {
  if (!wireText(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    return false
  const date = new Date(`${v}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
}
const monetary = new Set(['amount', 'actualAmount', 'grossAmount'])
const decimal = new Set(['hours', 'overtimeHours', 'quantity', 'unitPrice', 'profileDailyWage', 'configuredDailyWage', 'configuredOvertimeRate', 'dailyWage', 'overtimeRate', 'payRatio'])
/** 展开有限数的指数表示，保留最短可往返数值，不按金额位数舍入。 */
export function payrollFixedDecimal(value: number): string {
  if (!Number.isFinite(value))
    wireFail('十进制传输必须是有限数值')
  const rendered = String(value)
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(rendered)
  if (!match)
    return rendered
  const [, sign = '', integer = '', fraction = '', exponent = '0'] = match
  const digits = integer + fraction
  const point = integer.length + Number(exponent)
  if (point <= 0)
    return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length)
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}
export function transformPayrollC1Wire(value: unknown, decode: boolean): unknown {
  if (Array.isArray(value))
    return value.map(child => transformPayrollC1Wire(child, decode))
  if (!payrollObject(value))
    return value
  const metric = 'knownValue' in value && 'state' in value
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => {
    if (['history', 'beforeData', 'afterData', 'evidence'].includes(key))
      return [key, child]
    const money = monetary.has(key) || (metric && ['value', 'knownValue'].includes(key))
    if ((!money && !decimal.has(key)) || payrollObject(child))
      return [key, transformPayrollC1Wire(child, decode)]
    if (child === null)
      return [key, null]
    if (decode) {
      if (!wireText(child) || !(money ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(child) || !Number.isFinite(Number(child)))
        wireFail('工时、费率或金额传输格式无效')
      return [key, Number(child)]
    }
    if (!wireNumber(child) || (money && (!Number.isSafeInteger(amountInCents(child)) || Math.abs(child * 100 - amountInCents(child)) > 1e-8)))
      wireFail('金额须精确到分，工时与费率须为有限数值或明确空值')
    return [key, money ? child.toFixed(2) : payrollFixedDecimal(child)]
  }))
}
export function wireIntent(v: unknown) {
  return v === null || (payrollObject(v) && (v.kind === 'unavailable' ? wireText(v.reason) : ['entity-detail', 'entity-subview', 'source-record'].includes(String(v.kind)) && payrollObject(v.subject) && wireText(v.subject.id) && wireText(v.subject.entity) && payrollObject(v.filters) && wireNullableText(v.variant) && wireNullableText(v.view)))
}
export function wireContext(v: unknown, origin: string) {
  return payrollObject(v) && wireFields(v, ['workspaceId', 'actorId', 'sourceVersion'], wireText) && v.origin === origin && wireStrings(v.capabilities) && v.capabilities.includes('payroll:read') && typeof v.readonly === 'boolean' && (origin === 'real' ? v.readonly === !v.capabilities.includes('payroll:write') : v.readonly && v.capabilities.includes('demo:read'))
}

/** C2/签工独立传输数值：原行证据原样保留，价与工数不按金额舍入。 */
export function transformPayrollC2Wire(value: unknown, decode: boolean): unknown {
  if (Array.isArray(value))
    return value.map(child => transformPayrollC2Wire(child, decode))
  if (!payrollObject(value))
    return value
  const metric = 'knownValue' in value && 'state' in value
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => {
    if (['original', 'history', 'beforeData', 'afterData', 'evidence'].includes(key))
      return [key, child]
    const money = monetary.has(key) || (metric && ['value', 'knownValue'].includes(key))
    if ((!money && !['unitRate', 'unitPrice', 'laborUnits', 'quantity', 'payRatio'].includes(key)) || payrollObject(child))
      return [key, transformPayrollC2Wire(child, decode)]
    if (child === null)
      return [key, null]
    if (decode) {
      if (!wireText(child) || !(money ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).test(child) || !Number.isFinite(Number(child)))
        wireFail('签工工数、主体单价或金额传输格式无效')
      return [key, Number(child)]
    }
    if (!wireNumber(child) || (money && !wireCent(child)))
      wireFail('金额须为到分数值，签工工数与主体单价须为有限数值或明确空值')
    return [key, money ? child.toFixed(2) : payrollFixedDecimal(child)]
  }))
}
