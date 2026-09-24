import { quantityProblem } from './central-contract'

export function hollowObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function hollowKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return hollowObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
export function hollowId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
export function hollowIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(hollowId) && new Set(value).size === value.length
}
export function hollowCount(value: unknown, positive = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= (positive ? 1 : 0)
}
export function hollowCanonical(value: unknown): string {
  if (Array.isArray(value))
    return JSON.stringify(value.map(entry => JSON.parse(hollowCanonical(entry))))
  if (hollowObject(value))
    return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(hollowCanonical(value[key]))])))
  return JSON.stringify(value)
}
export function hollowEqual(left: unknown, right: unknown): boolean {
  return hollowCanonical(left) === hollowCanonical(right)
}
export async function hollowHash(raw: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function hollowInvalid(message: string): never {
  throw quantityProblem('validation-failed', message)
}
export function hollowJson(value: unknown): unknown {
  if (typeof value !== 'string')
    return hollowInvalid('空鼓原件不是完整 JSON 文本')
  try {
    return JSON.parse(value)
  }
  catch { return hollowInvalid('空鼓原件 JSON 无法解释') }
}
