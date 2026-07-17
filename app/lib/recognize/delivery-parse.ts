import { round2 } from '~/lib/util/number'

export interface ParsedDeliveryItem {
  name: string
  spec: string
  unit: string
  quantity: number | null
  unitPrice: number | null
  total: number | null
  note: string
}

export interface ParsedDeliveryDocument {
  supplier: string
  date: string
  orderNo: string
  siteText: string
  docType: '送货单' | '销售单' | '出货单' | '收据' | ''
  items: ParsedDeliveryItem[]
  statedTotal: number | null
  calculatedTotal: number
  balanced: boolean
  note: string
  headText: string
}

export interface ParsedDeliveryResult {
  supplier: string
  docs: ParsedDeliveryDocument[]
  rawText: string
}

type DeliveryColumn = 'name' | 'spec' | 'unit' | 'quantity' | 'unitPrice' | 'total' | 'note'
type ColumnMap = Partial<Record<DeliveryColumn, number>>

interface DeliveryTable {
  rows: string[][]
  rawText: string
}

interface ParsedItems {
  items: ParsedDeliveryItem[]
  statedTotal: number | null
}

const COMPANY_HINT_RE = /有限责任公司|股份有限公司|有限公司|分公司|经营部|商行|商贸|贸易|建材|电缆|照明|装饰|设备|供应链|厂|店/
const BUYER_FIELD_RE = /^(?:客户|需方|购方|收货单位|送货单位|收货人|送货地址|送货地点|收货地址|收货地点|项目名称|项目|工地|地址|电话|联系电话|联系人|开户|账号|税号|统一社会信用代码|经手|经办|制单|司机|审核|审批|签收|签字|承运|备注|日期)/
const DOC_TYPE_TAIL_RE = /(?:送货单|销货清单|销售清单|出货单|送货清单|发货单|销售单|对账单|清单|送货)$/
const AGGREGATE_ROW_RE = /合\s*计|总\s*计|本页合计|总金额|应收|实收|大写/
const NOISE_ITEM_RE = /^(?:备注|说明|大写|送货方式|注意|白色联|红色联|黄色联|绿色联|蓝色联|存根)$/
const UNIT_RE = /^(?:[个件套张块片条支根包袋盒瓶桶罐卷捆扎台把只双副米方吨斤车次项mt㎡]|厘米|cm|平方|平方米|m2|立方|m3|公斤|kg)$/i

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
}

function stripInline(value: string): string {
  return decodeEntities(String(value || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[#>`®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function textLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(stripInline)
    .filter(Boolean)
}

function parseNumber(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/[,，\s¥￥元]/g, '')
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized))
    return null
  const result = Number(normalized)
  return Number.isFinite(result) ? round2(result) : null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function findDate(lines: string[]): string {
  const text = lines.join(' ')
  const match = text.match(/(20\d{2})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})/)
    || text.match(/(20\d{2})(\d{2})(\d{2})/)
  if (!match)
    return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31)
    return ''
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function trailingSerial(value: string): string {
  return value.match(/(00\d{2,})$/)?.[1] ?? ''
}

function validOrderNumber(value: string): string {
  const normalized = value.replace(/^[#：:\s]+|[，,。；;]+$/g, '')
  if (/^\d{15,}$/.test(normalized))
    return trailingSerial(normalized)
  return normalized.length >= 4 ? normalized : ''
}

function findOrderNo(lines: string[]): string {
  const label = /(?:送货单号|销售单号|出货单号|单据编号|单据号|单号|编号|No\.?)\s*(?:[:：]\s*)?([a-z0-9][a-z0-9\-/]{3,})/i
  for (const line of lines) {
    const match = line.match(label)
    if (match?.[1])
      return validOrderNumber(match[1])
  }

  let fallback = ''
  for (const line of lines) {
    if (/税|信用|电话|地址|日期|时间|页/.test(line))
      continue
    for (const candidate of line.match(/[a-z0-9][a-z0-9-]{5,}/gi) ?? []) {
      if (/\d{4,}/.test(candidate) && candidate.length > fallback.length)
        fallback = candidate
    }
  }
  return validOrderNumber(fallback)
}

function cleanSupplier(value: string): string {
  return stripInline(value)
    .replace(/\s+/g, '')
    .replace(/^(?:供货单位|供方|销售方|供应商|公司名称|名称)[:：]?/, '')
    .replace(DOC_TYPE_TAIL_RE, '')
    .trim()
}

function findSupplier(lines: string[]): string {
  for (const raw of lines) {
    const compact = stripInline(raw).replace(/\s+/g, '')
    if (!compact || BUYER_FIELD_RE.test(compact) || !COMPANY_HINT_RE.test(compact))
      continue
    const supplier = cleanSupplier(compact)
    if (supplier.length >= 3 && supplier.length <= 60)
      return supplier
  }
  return ''
}

function findSiteText(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/(?:工地(?:名称)?|项目(?:名称)?|送货(?:地址|地点)|收货(?:地址|地点))\s*[:：]\s*([^\n]{2,80})/)
    if (match?.[1])
      return match[1].trim()
  }
  return ''
}

function findDocType(lines: string[]): ParsedDeliveryDocument['docType'] {
  const match = lines.join(' ').match(/送货单|销售单|出货单|收据/)
  return (match?.[0] as ParsedDeliveryDocument['docType'] | undefined) ?? ''
}

function htmlTables(markdown: string): { table: DeliveryTable, start: number, end: number }[] {
  const output: { table: DeliveryTable, start: number, end: number }[] = []
  for (const match of markdown.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    if (match.index == null || !match[1])
      continue
    const rows: string[][] = []
    for (const rowMatch of match[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!rowMatch[1])
        continue
      const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map(cell => stripInline(cell[1] ?? ''))
      if (cells.length > 1)
        rows.push(cells)
    }
    if (rows.length) {
      output.push({
        table: { rows, rawText: stripInline(match[0]) },
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }
  return output
}

function splitPipeRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(stripInline)
}

function separatorRow(cells: string[]): boolean {
  return cells.every(cell => !cell || /^:?-{2,}:?$/.test(cell))
}

function mapHeader(cells: string[]): ColumnMap | null {
  const columns: ColumnMap = {}
  for (const [index, rawCell] of cells.entries()) {
    const cell = rawCell.replace(/\s/g, '')
    if (/名称及规格/.test(cell))
      columns.name ??= index
    else if (/备注|说明/.test(cell))
      columns.note ??= index
    else if (/规格|型号/.test(cell))
      columns.spec ??= index
    else if (/单价/.test(cell))
      columns.unitPrice ??= index
    else if (/数量|总数量/.test(cell))
      columns.quantity ??= index
    else if (/金额|总价|小计/.test(cell))
      columns.total ??= index
    else if (/单位/.test(cell))
      columns.unit ??= index
    else if (/商品名称|材料名称|产品名称|货品名称|名称及规格|品名|货名|材料|产品|项目/.test(cell))
      columns.name ??= index
  }
  return columns.name != null && Object.keys(columns).length >= 3 ? columns : null
}

function inferredColumns(cells: string[]): ColumnMap | null {
  if (cells.length < 5)
    return null
  const offset = /^\d+$/.test(cells[0] ?? '') ? 1 : 0
  if (cells.length - offset < 5)
    return null
  return {
    name: offset,
    unit: offset + 1,
    quantity: offset + 2,
    unitPrice: offset + 3,
    total: offset + 4,
  }
}

function amountFromAggregate(cells: string[]): number | null {
  const amountInText = (value: string): number | null => {
    const matches = [...value.matchAll(/[\d,]+(?:\.\d+)?/g)]
    const amount = matches.at(-1)?.[0]
    return amount ? parseNumber(amount) : null
  }
  const pageAmount = cells.find(cell => /本页(?:金额|合计)|页金额/.test(cell))
  if (pageAmount) {
    const amount = amountInText(pageAmount)
    if (amount != null)
      return amount
  }
  const labelledAmount = cells.find(cell => /合\s*计|总\s*计|总金额/.test(cell))
  if (labelledAmount) {
    const amount = amountInText(labelledAmount)
    if (amount != null)
      return amount
  }
  for (const cell of [...cells].reverse()) {
    const amount = parseNumber(cell)
    if (amount != null)
      return amount
  }
  return null
}

function tableItems(table: DeliveryTable): ParsedItems {
  const headerIndex = table.rows.findIndex(row => mapHeader(row) != null)
  const header = headerIndex >= 0
    ? mapHeader(table.rows[headerIndex]!)
    : inferredColumns(table.rows[0] ?? [])
  if (!header || header.name == null)
    return { items: [], statedTotal: null }

  const dataRows = headerIndex >= 0 ? table.rows.slice(headerIndex + 1) : table.rows
  const items: ParsedDeliveryItem[] = []
  let statedTotal: number | null = null
  for (const cells of dataRows) {
    const joined = cells.join('').replace(/\s/g, '')
    if (!joined)
      continue
    if (AGGREGATE_ROW_RE.test(joined)) {
      statedTotal ??= amountFromAggregate(cells)
      continue
    }

    const name = String(cells[header.name] ?? '').trim()
    if (!name
      || /^[-—\s]*$/.test(name)
      || /品名|名称|材料|产品/.test(name)
      || BUYER_FIELD_RE.test(name)
      || NOISE_ITEM_RE.test(name)) {
      continue
    }

    const spec = header.spec == null ? '' : String(cells[header.spec] ?? '').trim()
    const unit = header.unit == null ? '' : String(cells[header.unit] ?? '').trim()
    const quantity = header.quantity == null ? null : parseNumber(cells[header.quantity])
    const unitPrice = header.unitPrice == null ? null : parseNumber(cells[header.unitPrice])
    let total = header.total == null ? null : parseNumber(cells[header.total])
    let note = header.note == null ? '' : String(cells[header.note] ?? '').trim()

    if (!unit && quantity == null && unitPrice == null && total == null && items.length) {
      const previous = items.at(-1)!
      previous.spec = [previous.spec, spec || name].filter(Boolean).join(' ')
      continue
    }
    if (quantity == null && unitPrice == null && total == null)
      continue
    if (total == null && quantity != null && unitPrice != null)
      total = round2(quantity * unitPrice)
    if (/^\d+(?:\.\d+)?$/.test(name) || (unit && !UNIT_RE.test(unit)) || total == null)
      note = [note, 'OCR 低置信字段（待复核）'].filter(Boolean).join('；')
    if (quantity != null && unitPrice != null && total != null && Math.abs(round2(quantity * unitPrice) - total) > 1)
      note = [note, '金额与数量×单价不符（待复核）'].filter(Boolean).join('；')

    items.push({ name, spec, unit, quantity, unitPrice, total, note })
  }

  if (statedTotal == null) {
    const match = table.rawText.match(/(?:本页(?:金额|合计)|页金额)[^\d¥￥]{0,20}[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
      || table.rawText.match(/(?:合\s*计|总\s*计|总金额)[^\d¥￥]{0,20}[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
    statedTotal = match?.[1] ? parseNumber(match[1]) : null
  }
  return { items, statedTotal }
}

function reviewSummary(items: ParsedDeliveryItem[], statedTotal: number | null): Pick<ParsedDeliveryDocument, 'calculatedTotal' | 'balanced' | 'note'> {
  const calculatedTotal = round2(items.reduce((sum, item) => sum + (item.total ?? 0), 0))
  const badRows = items.filter(item => /待复核/.test(item.note)).length
  const notes: string[] = []
  if (badRows)
    notes.push(`${badRows} 行金额与数量×单价不符（待复核）`)
  const totalMismatch = statedTotal != null
    && calculatedTotal > 0
    && Math.abs(calculatedTotal - statedTotal) > 1
  if (totalMismatch)
    notes.push(`票面合计 ¥${statedTotal} 与明细求和 ¥${calculatedTotal} 不符（待复核）`)
  return {
    calculatedTotal,
    balanced: statedTotal != null && calculatedTotal > 0 && !badRows && !totalMismatch,
    note: notes.join('；'),
  }
}

function documentFromTable(
  table: DeliveryTable,
  headerLines: string[],
  fileLines: string[],
  fileSupplier: string,
): ParsedDeliveryDocument | null {
  const parsed = tableItems(table)
  if (!parsed.items.length)
    return null
  const summary = reviewSummary(parsed.items, parsed.statedTotal)
  return {
    supplier: findSupplier(headerLines)
      || findSupplier(table.rows.flatMap(row => row.flatMap(textLines)))
      || fileSupplier,
    date: findDate(headerLines) || findDate(fileLines),
    orderNo: findOrderNo(headerLines),
    siteText: findSiteText(headerLines) || findSiteText(fileLines),
    docType: findDocType(headerLines) || findDocType(fileLines),
    items: parsed.items,
    statedTotal: parsed.statedTotal,
    ...summary,
    headText: headerLines.join('\n'),
  }
}

function documentsFromHtmlPage(markdown: string, fileLines: string[], fileSupplier: string): ParsedDeliveryDocument[] {
  const tables = htmlTables(markdown)
  if (!tables.length)
    return []
  const documents: ParsedDeliveryDocument[] = []
  let cursor = 0
  for (const entry of tables) {
    const headerLines = textLines(markdown.slice(cursor, entry.start))
    const document = documentFromTable(entry.table, headerLines, fileLines, fileSupplier)
    if (document)
      documents.push(document)
    cursor = entry.end
  }
  return documents
}

function documentsFromMarkdownPage(markdown: string, fileLines: string[], fileSupplier: string): ParsedDeliveryDocument[] {
  const documents: ParsedDeliveryDocument[] = []
  const pendingText: string[] = []
  let rows: string[][] = []

  const flush = () => {
    if (!rows.length)
      return
    const table = { rows, rawText: rows.flat().join(' ') }
    const document = documentFromTable(table, [...pendingText], fileLines, fileSupplier)
    if (document)
      documents.push(document)
    rows = []
    pendingText.length = 0
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    if (rawLine.includes('|') && rawLine.split('|').length >= 3) {
      const cells = splitPipeRow(rawLine)
      if (!separatorRow(cells))
        rows.push(cells)
      continue
    }
    flush()
    const line = stripInline(rawLine)
    if (line)
      pendingText.push(line)
  }
  flush()
  return documents
}

function parsePlainItems(lines: string[]): ParsedDeliveryItem[] {
  const items: ParsedDeliveryItem[] = []
  const seen = new Set<string>()
  for (const rawLine of lines) {
    if (/品名|规格|数量|单价|金额|合计|客户|需方|送货单|销售单|出货单|地址|电话|签收|日期|单号|编号/.test(rawLine))
      continue
    const tokens = rawLine.replace(/[|,，;；]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    const unitIndex = tokens.findIndex((token, index) => index > 0 && UNIT_RE.test(token ?? ''))
    if (unitIndex < 1)
      continue
    const name = tokens.slice(0, unitIndex).join(' ').replace(/^\d+[.、)]\s*/, '').trim()
    if (!name || COMPANY_HINT_RE.test(name))
      continue
    const numbers = tokens.slice(unitIndex + 1).map(parseNumber)
    const quantity = numbers[0] ?? null
    const unitPrice = numbers[1] ?? null
    const total = numbers[2] ?? (quantity != null && unitPrice != null ? round2(quantity * unitPrice) : null)
    if (quantity == null && total == null)
      continue
    const key = [name, tokens[unitIndex], quantity, unitPrice, total].join('|')
    if (seen.has(key))
      continue
    seen.add(key)
    items.push({
      name,
      spec: '',
      unit: tokens[unitIndex] ?? '',
      quantity,
      unitPrice,
      total,
      note: '',
    })
  }
  return items
}

function mergeSameOrderDocuments(documents: ParsedDeliveryDocument[]): ParsedDeliveryDocument[] {
  const output: ParsedDeliveryDocument[] = []
  for (const document of documents) {
    const existing = document.orderNo
      ? output.find(candidate => candidate.orderNo === document.orderNo && candidate.supplier === document.supplier)
      : undefined
    if (!existing) {
      output.push(document)
      continue
    }
    existing.items.push(...document.items)
    existing.statedTotal = document.statedTotal ?? existing.statedTotal
    Object.assign(existing, reviewSummary(existing.items, existing.statedTotal))
  }
  return output
}

/** PaddleOCR-VL 的 Markdown/HTML 版面结果 → 可人工校对的送货单字段与材料行。 */
export function parseDeliveryMarkdown(markdownPages: string[]): ParsedDeliveryResult {
  const pages = markdownPages.map(page => String(page || ''))
  const withoutTables = pages.map(page => page.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ' '))
  const fileLines = withoutTables.flatMap(textLines)
  const fileSupplier = findSupplier(fileLines)
  const documents = pages.flatMap((page) => {
    const htmlDocuments = documentsFromHtmlPage(page, fileLines, fileSupplier)
    return htmlDocuments.length
      ? htmlDocuments
      : documentsFromMarkdownPage(page, fileLines, fileSupplier)
  })

  if (!documents.length) {
    const items = parsePlainItems(fileLines)
    documents.push({
      supplier: fileSupplier,
      date: findDate(fileLines),
      orderNo: findOrderNo(fileLines),
      siteText: findSiteText(fileLines),
      docType: findDocType(fileLines),
      items,
      statedTotal: null,
      ...reviewSummary(items, null),
      headText: fileLines.join('\n'),
    })
  }

  const mergedDocuments = mergeSameOrderDocuments(documents)
  return {
    supplier: fileSupplier || mergedDocuments.find(document => document.supplier)?.supplier || '',
    docs: mergedDocuments,
    rawText: fileLines.join('\n'),
  }
}
