import { round2 } from '~/lib/util/number'

export interface ParsedInvoiceItem {
  name: string
  spec: string
  unit: string
  quantity: number
  unitPrice: number
  amount: number
  taxRate: string
  taxAmount: number
}

export interface ParsedInvoice {
  invoiceType: string
  invoiceNumber: string
  invoiceDate: string
  buyer: string
  buyerTaxNo: string
  seller: string
  sellerTaxNo: string
  amount: number | null
  taxAmount: number | null
  totalAmount: number | null
  taxRate: string
  remark: string
  projectHint: string
  items: ParsedInvoiceItem[]
  balanced: boolean
}

const RADICAL_FIX: Record<string, string> = {
  '⻨': '麦',
  '⻝': '食',
  '⻆': '角',
  '⻔': '门',
  '⻢': '马',
  '⻅': '见',
}

const COMPANY_SUFFIX_RE = /有限责任公司|股份有限公司|有限公司|分公司|个体工商户|经营部|商行|商店|门市部|合作社|事务所|工作室|厂/
const COMPANY_MATCH_RE = /[\p{L}\p{N}()（）·-]{2,60}?(?:有限责任公司|股份有限公司|有限公司|分公司|个体工商户|经营部|商行|商店|门市部|合作社|事务所|工作室|厂)/gu
const TAX_ID_RE = /(?<![0-9A-Z])([0-9A-Z](?:[ \t]*[0-9A-Z]){14,19})(?![0-9A-Z])/g
const MONEY_WITH_SYMBOL_RE = /[¥￥][ \t]*([+-]?\d(?:[0-9,， \t]*\d)?[ \t]*\.[ \t]*\d[ \t]*\d)/g
const KNOWN_TAX_RATES = new Set(['0', '1', '1.5', '2', '3', '4', '5', '6', '9', '10', '11', '13', '16', '17'])
const INVOICE_ITEM_UNIT_RE = /^(?:[个件套张块片条支根包袋盒瓶桶卷台把米吨次项]|公斤)$/

type InvoiceItemColumn = 'name' | 'spec' | 'unit' | 'quantity' | 'unitPrice' | 'amount' | 'taxRate' | 'taxAmount'

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
}

function applyCharacterFixes(value: string): string {
  let result = value.normalize('NFKC')
  for (const [from, to] of Object.entries(RADICAL_FIX))
    result = result.replaceAll(from, to)
  return result
}

function normalizeText(rawText: string): string {
  const withTableBreaks = String(rawText || '')
    .replace(/<br\s*(?:\/\s*)?>/gi, '\n')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
  return applyCharacterFixes(decodeEntities(withTableBreaks))
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

function compactChineseSpacing(value: string): string {
  return value.replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '')
}

function removeAsciiControlCharacters(value: string): string {
  let result = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint == null || codePoint >= 32)
      result += character
  }
  return result
}

function digitsOnly(value: string): string {
  return value.replace(/\s/g, '')
}

function parseNumber(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/[,，\s¥￥元]/g, '')
  if (!normalized || !/^[+-]?\d+(?:\.\d+)?$/.test(normalized))
    return null
  const result = Number(normalized)
  return Number.isFinite(result) ? round2(result) : null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function extractInvoiceNumber(text: string): string {
  const labelled = text.match(/发\s*票\s*号\s*码\s*(?:[:：][^\xA0\S\n]*)?(\d(?:[ \t]*\d){7,24})/)
    || text.match(/票\s*据\s*号\s*码\s*(?:[:：][^\xA0\S\n]*)?(\d(?:[ \t]*\d){7,24})/)
  const labelledValue = labelled?.[1]
  if (labelledValue) {
    const value = digitsOnly(labelledValue)
    if (value.length >= 8 && value.length <= 25)
      return value
  }

  const compactLines = text.split('\n').map(line => line.replace(/[ \t]/g, ''))
  for (const line of compactLines) {
    const bare = line.match(/(?<!\d)(\d{20})(?!\d)/)
    if (bare)
      return bare[1] ?? ''
  }
  return ''
}

function extractInvoiceDate(text: string): string {
  const match = text.match(/(\d(?:[ \t]*\d){3})\s*年\s*(\d(?:[ \t]*\d)?)\s*月\s*(\d(?:[ \t]*\d)?)\s*日/)
    || text.match(/(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/)
  if (!match)
    return ''
  const [yearText, monthText, dayText] = match.slice(1, 4)
  if (!yearText || !monthText || !dayText)
    return ''
  const year = Number(digitsOnly(yearText))
  const month = Number(digitsOnly(monthText))
  const day = Number(digitsOnly(dayText))
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31)
    return ''
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function cleanCompanyName(value: string): string {
  return removeAsciiControlCharacters(compactChineseSpacing(value))
    .replace(/^(?:购买方|买方|付款方|销售方|卖方|收款方|购方|销方|信息|名称|[:：\s])+/g, '')
    .replace(/[：:]$/g, '')
    .trim()
}

function validCompanyName(value: string): boolean {
  return value.length >= 3
    && value.length <= 60
    && /\p{Script=Han}/u.test(value)
    && COMPANY_SUFFIX_RE.test(value)
    && !/发票|国家税务|监制章/.test(value)
}

function extractCompanies(text: string): string[] {
  const output: string[] = []
  const push = (value: string) => {
    const cleaned = cleanCompanyName(value)
    if (validCompanyName(cleaned) && !output.includes(cleaned))
      output.push(cleaned)
  }

  for (const match of text.matchAll(/名\s*称\s*[:：][ \t]*([^\n]+)/g)) {
    const candidates = compactChineseSpacing(match[1] ?? '').match(COMPANY_MATCH_RE) || []
    candidates.forEach(push)
  }

  for (const line of text.split('\n')) {
    const candidates = compactChineseSpacing(line).match(COMPANY_MATCH_RE) || []
    candidates.forEach(push)
  }
  return output
}

function extractTaxIds(text: string, invoiceNumber: string): string[] {
  const output: string[] = []
  const push = (raw: string) => {
    const value = digitsOnly(raw).toUpperCase()
    if (value === invoiceNumber || value.length < 15 || value.length > 20)
      return
    if (!/[A-Z]/.test(value))
      return
    if (!output.includes(value))
      output.push(value)
  }

  for (const match of text.toUpperCase().matchAll(TAX_ID_RE)) {
    if (match[1])
      push(match[1])
  }
  return output
}

function moneyValuesFromLine(line: string): number[] {
  const values: number[] = []
  for (const match of line.matchAll(MONEY_WITH_SYMBOL_RE)) {
    const value = parseNumber(match[1] ?? '')
    if (value != null)
      values.push(value)
  }
  return values
}

function totalFromText(text: string): number | null {
  const sameLine = text.match(/(?:价\s*税\s*合\s*计[^\n]{0,30}?小\s*写|小\s*写)[^\n¥￥0-9]{0,20}[¥￥]?[ \t]*(\d(?:[0-9,， \t]*\d)?[ \t]*\.[ \t]*\d[ \t]*\d)/)
  if (sameLine)
    return parseNumber(sameLine[1])

  const uppercaseLine = text.match(/[零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分]{2,}[^\n¥￥]{0,20}[¥￥][ \t]*(\d(?:[0-9,， \t]*\d)?[ \t]*\.[ \t]*\d[ \t]*\d)/)
  return uppercaseLine ? parseNumber(uppercaseLine[1]) : null
}

function labelledTaxAmount(text: string): number | null {
  const compact = text.replace(/[ \t]/g, '')
  const match = compact.match(/税额[:：]?[¥￥]?([\d,，]+\.\d{2})/)
  return match ? parseNumber(match[1]) : null
}

function extractMoneyFields(text: string, items: ParsedInvoiceItem[]): Pick<ParsedInvoice, 'amount' | 'taxAmount' | 'totalAmount' | 'balanced'> {
  let totalAmount = totalFromText(text)
  let amount: number | null = null
  let taxAmount: number | null = null
  let independentAmount = false

  const pairs = text
    .split('\n')
    .map(moneyValuesFromLine)
    .filter((values): values is [number, number, ...number[]] => values.length >= 2)
  const matchingPair = totalAmount == null
    ? pairs[0]
    : pairs.find(values => Math.abs(values[0] + values[1] - totalAmount!) <= 0.02) || pairs[0]
  if (matchingPair) {
    amount = matchingPair[0]
    taxAmount = matchingPair[1]
    independentAmount = true
  }

  if (items.length) {
    const itemAmount = round2(items.reduce((sum, item) => sum + item.amount, 0))
    const itemTax = round2(items.reduce((sum, item) => sum + item.taxAmount, 0))
    if (itemAmount > 0) {
      amount = itemAmount
      independentAmount = true
    }
    if (itemTax > 0)
      taxAmount = itemTax
  }

  taxAmount ??= labelledTaxAmount(text)
  if (totalAmount == null && amount != null && taxAmount != null)
    totalAmount = round2(amount + taxAmount)
  if (amount == null && totalAmount != null && taxAmount != null)
    amount = round2(totalAmount - taxAmount)
  if (taxAmount == null && totalAmount != null && amount != null)
    taxAmount = round2(totalAmount - amount)

  const balanced = independentAmount
    && amount != null
    && taxAmount != null
    && totalAmount != null
    && Math.abs(round2(amount + taxAmount) - totalAmount) <= 0.02
  return { amount, taxAmount, totalAmount, balanced }
}

function extractTaxRate(text: string, items: ParsedInvoiceItem[]): string {
  const values = new Set<string>()
  for (const item of items) {
    const normalized = item.taxRate.replace('%', '')
    if (KNOWN_TAX_RATES.has(normalized))
      values.add(normalized)
  }
  for (const match of text.matchAll(/(?<![0-9.])(\d(?:[ \t]*\d)?(?:[ \t]*\.[ \t]*\d)?)[ \t]*%/g)) {
    const normalized = digitsOnly(match[1] ?? '')
    if (KNOWN_TAX_RATES.has(normalized))
      values.add(normalized)
  }
  const [singleRate] = values
  return values.size === 1 && singleRate ? `${singleRate}%` : ''
}

function stripCell(value: string): string {
  return applyCharacterFixes(decodeEntities(value.replace(/<[^>]+>/g, ' ')))
    .replace(/\s+/g, ' ')
    .trim()
}

function splitPipeRow(line: string): string[] {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return value.split('|').map(stripCell)
}

function extractTableRows(rawText: string): string[][][] {
  const tables: string[][][] = []
  for (const tableMatch of rawText.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableBody = tableMatch[1]
    if (!tableBody)
      continue
    const rows: string[][] = []
    for (const rowMatch of tableBody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowBody = rowMatch[1]
      if (!rowBody)
        continue
      const cells = [...rowBody.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(match => stripCell(match[1] ?? ''))
      if (cells.length)
        rows.push(cells)
    }
    if (rows.length)
      tables.push(rows)
  }

  let current: string[][] = []
  for (const line of rawText.split(/\r?\n/)) {
    if (line.includes('|') && line.split('|').length >= 3) {
      const cells = splitPipeRow(line)
      if (!cells.every(cell => /^:?-{2,}:?$/.test(cell) || !cell))
        current.push(cells)
    }
    else if (current.length) {
      tables.push(current)
      current = []
    }
  }
  if (current.length)
    tables.push(current)
  return tables
}

function mapInvoiceHeader(cells: string[]): Partial<Record<InvoiceItemColumn, number>> | null {
  const columns: Partial<Record<InvoiceItemColumn, number>> = {}
  cells.forEach((rawCell, index) => {
    const cell = compactChineseSpacing(rawCell)
    if (/税额/.test(cell))
      columns.taxAmount ??= index
    else if (/税率|征收率/.test(cell))
      columns.taxRate ??= index
    else if (/项目名称|货物|劳务|服务名称|商品名称|品名|材料名称/.test(cell))
      columns.name ??= index
    else if (/规格|型号/.test(cell))
      columns.spec ??= index
    else if (/单位/.test(cell))
      columns.unit ??= index
    else if (/数量/.test(cell))
      columns.quantity ??= index
    else if (/单价/.test(cell))
      columns.unitPrice ??= index
    else if (/金额|不含税/.test(cell))
      columns.amount ??= index
  })
  return columns.name != null && Object.keys(columns).length >= 3 ? columns : null
}

function parseTableItems(rawText: string): ParsedInvoiceItem[] {
  const items: ParsedInvoiceItem[] = []
  for (const rows of extractTableRows(rawText)) {
    const headerIndex = rows.findIndex(row => mapInvoiceHeader(row) != null)
    if (headerIndex < 0)
      continue
    const headerRow = rows[headerIndex]
    if (!headerRow)
      continue
    const columns = mapInvoiceHeader(headerRow)
    if (!columns)
      continue
    for (const cells of rows.slice(headerIndex + 1)) {
      const name = columns.name == null ? '' : String(cells[columns.name] || '').trim()
      const compactName = compactChineseSpacing(name).replace(/\s/g, '')
      if (!name || /^(?:合计|总计|小计|价税合计|税价合计|备注$)/.test(compactName))
        continue
      const amount = parseNumber(columns.amount == null ? null : cells[columns.amount]) ?? 0
      const taxAmount = parseNumber(columns.taxAmount == null ? null : cells[columns.taxAmount]) ?? 0
      items.push({
        name,
        spec: columns.spec == null ? '' : String(cells[columns.spec] || ''),
        unit: columns.unit == null ? '' : String(cells[columns.unit] || ''),
        quantity: parseNumber(columns.quantity == null ? null : cells[columns.quantity]) ?? 0,
        unitPrice: parseNumber(columns.unitPrice == null ? null : cells[columns.unitPrice]) ?? 0,
        amount,
        taxRate: columns.taxRate == null ? '' : String(cells[columns.taxRate] || '').replace(/\s/g, ''),
        taxAmount,
      })
    }
  }
  return items
}

function extractInvoiceType(text: string): string {
  const compact = compactChineseSpacing(text)
  const match = compact.match(/电子发票[（(](?:增值税)?(?:专用|普通)发票[）)]|增值税电子专用发票|增值税电子普通发票|增值税专用发票|增值税普通发票|电子发票|普通发票|专用发票|数电发票/)
  return match?.[0].replace('(', '（').replace(')', '）') || ''
}

function extractRemark(text: string): string {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line)
      continue
    const label = line.match(/备\s*注/)
    if (!label || label.index == null)
      continue
    const remainder = line.slice(label.index + label[0].length).replace(/^[\s:：]+/, '').trim()
    const parts = [remainder].filter(Boolean)
    for (let next = index + 1; next < Math.min(lines.length, index + 4); next++) {
      const nextLine = lines[next]
      if (!nextLine)
        continue
      if (/^(?:购买方|销售方|合计|价税合计|开票人|发票号码|开票日期|项目名称)/.test(nextLine))
        break
      parts.push(nextLine)
    }
    return parts.join(' ').trim()
  }
  return ''
}

function extractProjectHint(text: string): string {
  const match = text.match(/(?:项目名称|工程名称|工地名称|工地)\s*[:：][ \t]*([^\n]{2,60})/)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function fallbackItem(text: string, money: Pick<ParsedInvoice, 'amount' | 'taxAmount' | 'taxRate'>): ParsedInvoiceItem[] {
  const categoryMatch = text.match(/\*([^*\n]{1,24})\*/)
  if (!categoryMatch || categoryMatch.index == null)
    return []
  const category = categoryMatch[1]?.trim()
  const detail = text
    .slice(categoryMatch.index + categoryMatch[0].length)
    .split('\n')[0]
    ?.trim()
  if (!category || !detail)
    return []
  const detailTokens = detail.split(/[ \t]+/)
  const valueStart = detailTokens.findIndex((token, index) =>
    index > 0 && (INVOICE_ITEM_UNIT_RE.test(token) || /^[+-]?\d/.test(token)),
  )
  const name = (valueStart > 0 ? detailTokens.slice(0, valueStart).join(' ') : detail.replace(/[¥￥\d].*$/, '')).trim()
  if (!name)
    return []
  return [{
    name: `*${category}*${name}`,
    spec: '',
    unit: '',
    quantity: 0,
    unitPrice: 0,
    amount: money.amount ?? 0,
    taxRate: money.taxRate,
    taxAmount: money.taxAmount ?? 0,
  }]
}

export function parseInvoiceText(rawText: string): ParsedInvoice {
  const text = normalizeText(rawText)
  const invoiceNumber = extractInvoiceNumber(text)
  const companies = extractCompanies(text)
  const taxIds = extractTaxIds(text, invoiceNumber)
  const tableItems = parseTableItems(rawText)
  let items = tableItems
  const money = extractMoneyFields(text, tableItems)
  const taxRate = extractTaxRate(text, tableItems)
  if (!items.length)
    items = fallbackItem(text, { ...money, taxRate })

  return {
    invoiceType: extractInvoiceType(text),
    invoiceNumber,
    invoiceDate: extractInvoiceDate(text),
    buyer: companies[0] || '',
    buyerTaxNo: taxIds[0] || '',
    seller: companies[1] || '',
    sellerTaxNo: taxIds[1] || '',
    amount: money.amount,
    taxAmount: money.taxAmount,
    totalAmount: money.totalAmount,
    taxRate,
    remark: extractRemark(text),
    projectHint: extractProjectHint(text),
    items,
    balanced: money.balanced,
  }
}

export function buildInvoiceFieldConfidence(parsed: ParsedInvoice): Record<string, number> {
  const moneyConfidence = parsed.balanced ? 0.98 : 0.78
  return {
    invoiceType: parsed.invoiceType ? 0.96 : 0.3,
    invoiceNumber: /^\d{8,25}$/.test(parsed.invoiceNumber) ? 0.99 : 0.3,
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoiceDate) ? 0.98 : 0.3,
    buyer: parsed.buyer ? 0.94 : 0.3,
    buyerTaxNo: /^[0-9A-Z]{15,20}$/.test(parsed.buyerTaxNo) ? 0.97 : 0.3,
    seller: parsed.seller ? 0.94 : 0.3,
    sellerTaxNo: /^[0-9A-Z]{15,20}$/.test(parsed.sellerTaxNo) ? 0.97 : 0.3,
    amount: parsed.amount != null ? moneyConfidence : 0.3,
    taxAmount: parsed.taxAmount != null ? moneyConfidence : 0.3,
    totalAmount: parsed.totalAmount != null ? moneyConfidence : 0.3,
    taxRate: parsed.taxRate ? 0.92 : 0.4,
  }
}
