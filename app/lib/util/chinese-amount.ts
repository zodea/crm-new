const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const
const UNITS = ['', '拾', '佰', '仟'] as const
const BIG_UNITS = ['', '万', '亿', '兆'] as const

export function moneyToChinese(amount: number): string {
  if (amount === 0)
    return '零元整'
  if (amount < 0)
    return `负${moneyToChinese(-amount)}`

  const totalFen = Math.round(amount * 100)
  const integer = Math.floor(totalFen / 100)
  const jiao = Math.floor((totalFen % 100) / 10)
  const fen = totalFen % 10
  let result = `${integer > 0 ? integerToChinese(integer) : DIGITS[0]}元`

  if (jiao === 0 && fen === 0)
    return `${result}整`

  if (jiao > 0)
    result += `${DIGITS[jiao]}角`
  else if (integer > 0 && fen > 0)
    result += DIGITS[0]

  if (fen > 0)
    result += `${DIGITS[fen]}分`

  return result
}

function integerToChinese(value: number): string {
  const groups: number[] = []
  let remaining = Math.floor(value)
  while (remaining > 0) {
    groups.push(remaining % 10_000)
    remaining = Math.floor(remaining / 10_000)
  }

  let result = ''
  let skippedGroup = false
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index] ?? 0
    if (group === 0) {
      if (result)
        skippedGroup = true
      continue
    }

    if (result && (skippedGroup || group < 1_000) && !result.endsWith(DIGITS[0]))
      result += DIGITS[0]

    result += sectionToChinese(group) + (BIG_UNITS[index] ?? '')
    skippedGroup = false
  }

  return result
}

function sectionToChinese(section: number): string {
  let result = ''
  let zeroPending = false

  for (let unitIndex = 3; unitIndex >= 0; unitIndex--) {
    const power = 10 ** unitIndex
    const digit = Math.floor(section / power) % 10
    if (digit === 0) {
      if (result)
        zeroPending = true
      continue
    }

    if (zeroPending) {
      result += DIGITS[0]
      zeroPending = false
    }
    result += `${DIGITS[digit]}${UNITS[unitIndex] ?? ''}`
  }

  return result
}
