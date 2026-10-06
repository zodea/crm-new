/** Serializes the known finite value without rounding or exponent notation. */
export function decimalNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new Error('未知数值不能生成公共十进制值')
  const rendered = String(value)
  if (!/e/i.test(rendered))
    return rendered
  const [coefficient, exponent] = rendered.toLowerCase().split('e')
  const sign = coefficient!.startsWith('-') ? '-' : ''
  const unsigned = coefficient!.replace(/^-/, '')
  const point = unsigned.includes('.') ? unsigned.indexOf('.') : unsigned.length
  const digits = unsigned.replace('.', '')
  const position = point + Number(exponent)
  if (position <= 0)
    return `${sign}0.${'0'.repeat(-position)}${digits}`
  if (position >= digits.length)
    return `${sign}${digits}${'0'.repeat(position - digits.length)}`
  return `${sign}${digits.slice(0, position)}.${digits.slice(position)}`
}

/** The numeric editor/display adapter accepts only provably finite decimal values. */
export function isDecimalString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
    return false
  return Number(value) !== 0 || !/[1-9]/.test(value)
}
