const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UNITS = ['', '拾', '佰', '仟']
const BIG_UNITS = ['', '万', '亿', '兆']

export function moneyToChinese(amount: number): string {
  if (amount === 0) return '零元整'
  if (amount < 0) return `负${moneyToChinese(-amount)}`

  const fen = Math.round(amount * 100)
  const intPart = Math.floor(fen / 100)
  const jiao = Math.floor((fen % 100) / 10)
  const fenDigit = fen % 10

  let result = ''

  if (intPart > 0) {
    result = integerToChinese(intPart) + '元'
  }

  if (jiao === 0 && fenDigit === 0) {
    result += '整'
  }
  else {
    if (intPart > 0 && jiao === 0) {
      result += '零'
    }
    if (jiao > 0) {
      result += DIGITS[jiao] + '角'
    }
    if (fenDigit > 0) {
      if (jiao === 0 && intPart === 0) {
        result += DIGITS[fenDigit] + '分'
      }
      else {
        if (jiao === 0 && intPart > 0) {
          // 零已在上面添加
        }
        result += DIGITS[fenDigit] + '分'
      }
    }
  }

  return result
}

function integerToChinese(n: number): string {
  if (n === 0) return DIGITS[0]

  const s = String(n)
  const groups: number[][] = []
  for (let i = s.length; i > 0; i -= 4) {
    const start = Math.max(0, i - 4)
    groups.unshift(s.slice(start, i).split('').map(Number))
  }

  let result = ''
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    const bigUnit = BIG_UNITS[groups.length - 1 - gi] || ''
    let groupStr = ''
    let hasNonZero = false

    for (let i = 0; i < group.length; i++) {
      const d = group[i]
      const unit = UNITS[group.length - 1 - i]
      if (d === 0) {
        if (hasNonZero && i < group.length - 1 && group[i + 1] !== 0) {
          groupStr += '零'
        }
      }
      else {
        groupStr += DIGITS[d] + unit
        hasNonZero = true
      }
    }

    if (hasNonZero) {
      if (gi > 0 && group.length < 4 && result.length > 0 && !result.endsWith('零')) {
        result += '零'
      }
      result += groupStr + bigUnit
    }
    else if (result.length > 0 && !result.endsWith('零') && gi < groups.length - 1) {
      result += '零'
    }
  }

  return result.replace(/零+$/, '')
}
