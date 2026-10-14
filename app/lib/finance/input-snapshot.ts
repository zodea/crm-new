/** Capture the submitted data without turning invalid numeric input into valid NULL. */
export function captureFinanceInput<T>(value: T): T {
  if (Array.isArray(value))
    return value.map(item => captureFinanceInput(item)) as T
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, captureFinanceInput(item)])) as T
  return value
}

// This symbol is input provenance in memory. Object.entries/JSON omit it;
// copying a value edit retains it, while a copied/new row receives no token.
const lineIdentity = Symbol('finance-line-input')
export function captureFinanceLineIdentities(lines: readonly object[]): symbol[] {
  return lines.map((line) => {
    const existing: unknown = Reflect.get(line, lineIdentity)
    if (typeof existing === 'symbol')
      return existing
    const key = Symbol('submitted-line')
    Object.defineProperty(line, lineIdentity, { value: key, enumerable: true, configurable: true })
    return key
  })
}
export function forgetFinanceLineIdentity(line: object): void {
  Reflect.deleteProperty(line, lineIdentity)
}
export function applyFinanceLineIdentities<T extends { id?: string }>(lines: T[], submitted: readonly symbol[], identities: readonly { inputIndex: number, id: string }[], frozen: readonly { id?: string }[]): T[] {
  const adopted = new Map<symbol, string>()
  for (const row of identities) {
    const key = submitted[row.inputIndex]
    if (!key || !frozen.some(line => line.id === row.id) || adopted.has(key))
      throw new Error('原费用提交的明细身份映射尚未可靠读取，请保留当前输入与原编号。')
    adopted.set(key, row.id)
  }
  return lines.map((line) => {
    const token: unknown = Reflect.get(line, lineIdentity)
    const id = typeof token === 'symbol' ? adopted.get(token) : undefined
    if (!id)
      return line
    if (line.id && line.id !== id)
      throw new Error('后来输入与原费用稳定身份不一致，不能猜接另一条明细。')
    return { ...line, id }
  })
}
