export type QuantityFormulaResult
  = | { ok: true, normalized: string, value: number | null }
    | { ok: false, error: string }

type Operator = '+' | '-' | '*' | '/'
type Parenthesis = '(' | ')'

interface NumberToken {
  type: 'number'
  raw: string
  value: number
}

interface SymbolToken {
  type: 'symbol'
  value: Operator | Parenthesis
}

type Token = NumberToken | SymbolToken

const SYMBOLS: Record<string, Operator | Parenthesis | '.'> = {
  '+': '+',
  '＋': '+',
  '﹢': '+',
  '-': '-',
  '－': '-',
  '−': '-',
  '*': '*',
  '＊': '*',
  '×': '*',
  '/': '/',
  '／': '/',
  '÷': '/',
  '(': '(',
  '（': '(',
  ')': ')',
  '）': ')',
  '.': '.',
  '．': '.',
}

function asciiDigit(char: string): string | null {
  if (char >= '0' && char <= '9')
    return char
  const code = char.charCodeAt(0)
  return code >= 0xFF10 && code <= 0xFF19 ? String(code - 0xFF10) : null
}

function isRemarkCharacter(char: string): boolean {
  return /\p{Script=Han}/u.test(char)
    || /[\s：:，、；。·㎡²³]/u.test(char)
}

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = []
  let number = ''
  let depth = 0

  function pushNumber(): string | null {
    if (!number)
      return null
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(number))
      return '数字格式不正确'
    const value = Number(number)
    if (!Number.isFinite(value))
      return '数字超出可计算范围'
    tokens.push({ type: 'number', raw: number, value })
    number = ''
    return null
  }

  for (const char of input) {
    const digit = asciiDigit(char)
    if (digit != null) {
      number += digit
      continue
    }
    const symbol = SYMBOLS[char]
    if (symbol === '.') {
      number += symbol
      continue
    }
    const numberError = pushNumber()
    if (numberError)
      return numberError
    if (symbol) {
      tokens.push({ type: 'symbol', value: symbol })
      if (symbol === '(') {
        depth += 1
        if (depth > 64)
          return '算式过于复杂（括号最多 64 层）'
      }
      else if (symbol === ')') {
        depth -= 1
      }
      if (tokens.length > 2048)
        return '算式过于复杂（运算项过多）'
      continue
    }
    if (!isRemarkCharacter(char))
      return `包含不支持的字符「${char}」`
  }

  return pushNumber() ?? tokens
}

class FormulaParser {
  private index = 0

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): number {
    const value = this.expression()
    const extra = this.peek()
    if (!extra)
      return value
    if (extra.type === 'number')
      throw new Error('数字之间缺少运算符')
    if (extra.value === '(')
      throw new Error('数字与括号之间缺少运算符')
    if (extra.value === ')')
      throw new Error('括号不匹配')
    throw new Error('算式不完整')
  }

  private expression(): number {
    let value = this.term()
    while (this.matches('+') || this.matches('-')) {
      const operator = (this.previous() as SymbolToken).value
      const right = this.term()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  private term(): number {
    let value = this.unary()
    while (this.matches('*') || this.matches('/')) {
      const operator = (this.previous() as SymbolToken).value
      const right = this.unary()
      if (operator === '/' && right === 0)
        throw new Error('不能除以 0')
      value = operator === '*' ? value * right : value / right
    }
    return value
  }

  private unary(): number {
    if (this.matches('+'))
      return this.unary()
    if (this.matches('-'))
      return -this.unary()
    return this.primary()
  }

  private primary(): number {
    const token = this.peek()
    if (!token)
      throw new Error('算式不完整')
    if (token.type === 'number') {
      this.index += 1
      return token.value
    }
    if (token.value !== '(')
      throw new Error(token.value === ')' ? '括号不匹配' : '算式不完整')

    this.index += 1
    const value = this.expression()
    if (!this.matches(')'))
      throw new Error('括号不匹配')
    return value
  }

  private matches(value: Operator | Parenthesis): boolean {
    const token = this.peek()
    if (token?.type !== 'symbol' || token.value !== value)
      return false
    this.index += 1
    return true
  }

  private peek(): Token | undefined {
    return this.tokens[this.index]
  }

  private previous(): Token | undefined {
    return this.tokens[this.index - 1]
  }
}

/**
 * 解析现场复核量。中文备注与常见单位只作为说明跳过；真正的表达式仅允许数字、
 * 括号和四则运算。递归下降解析器避免 eval/Function 带来的代码执行风险。
 */
export function evaluateQuantityFormula(input: string): QuantityFormulaResult {
  if (!input.trim())
    return { ok: true, normalized: '', value: null }
  if (input.length > 4096)
    return { ok: false, error: '算式过长（最多 4096 个字符）' }

  // 现场常把部位写在纯中文括注中，例如“5×2（主卧）”；这类括注不参与数学分组。
  const withoutRemarkParentheses = input.replace(
    /[（(]([\p{Script=Han}\s：:，、；。·㎡²³]+)[）)]/gu,
    ' $1 ',
  )
  const tokenized = tokenize(withoutRemarkParentheses)
  if (typeof tokenized === 'string')
    return { ok: false, error: tokenized }
  if (!tokenized.some(token => token.type === 'number'))
    return { ok: false, error: '算式中没有数字' }

  try {
    const value = new FormulaParser(tokenized).parse()
    if (!Number.isFinite(value))
      return { ok: false, error: '计算结果超出有效范围' }
    const normalized = tokenized.map(token => token.type === 'number' ? token.raw : token.value).join('')
    return { ok: true, normalized, value }
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '算式无法解析',
    }
  }
}
