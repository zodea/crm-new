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
  aggregateTotals: ParsedAggregateTotals
}

interface ParsedAggregateTotals {
  pageTotal: number | null
  cumulativeTotal: number | null
  genericTotal: number | null
  subtotalTotal: number | null
}

interface ParsedDocumentSource {
  pageIndex: number
  tableIndex: number
  aggregateTotals: ParsedAggregateTotals
  sequenceStart: number | null
  sequenceEnd: number | null
  pageNumber: number | null
  pageCount: number | null
}

interface ParsedDeliveryDocumentPart extends ParsedDeliveryDocument {
  sources: ParsedDocumentSource[]
}

const COMPANY_HINT_RE = /有限责任公司|股份有限公司|有限公司|分公司|经营部|商行|商贸|贸易|建材|电缆|照明|装饰|设备|供应链|厂|店/
const BUYER_FIELD_RE = /^(?:客户(?:名称)?|需方|购方|收货单位|送货单位|收货人|送货人|送货地址|送货地点|收货地址|收货地点|项目名称|项目|工地|地址|电话|联系电话|联系人|开户|账号|税号|统一社会信用代码|经手人?|经办人?|制单人?|销售员|付款人|收款人|司机|审核|审批|签收|签字|承运|备注|日期)(?:\s*[（(][^）)]*[）)])?\s*(?:[:：]|$)/
const DOC_TYPE_TAIL_RE = /(?:送货单|销货清单|销售清单|出货单|送货清单|发货单|销售单|对账单|工作记录单|收款收据|收据|清单|送货)$/
const SUPPLIER_LOGO_PREFIX_RE = /^G[Z7]\s+(?=[\u3400-\u9FFF])/
const AGGREGATE_ROW_RE = /合\s*计|总\s*计|小计|^计[:：]|本页(?:金额|合计|小计)|分页(?:金额|合计|小计)|页金额|累计(?:金额|合计|总计|总金额)|总金额|应收|实收|大写/
const NOISE_ITEM_RE = /^(?:备注|说明|大写|送货方式|注意|白色联|红色联|黄色联|绿色联|蓝色联|存根)$/
const UNIT_RE = /^(?:[个件套张块片条支根包袋盒箱瓶桶罐卷捆扎台把只双副米方吨斤车次项mt㎡]|厘米|cm|平方|平方米|m2|立方|m3|公斤|kg)$/i
const ITEM_HEADER_VALUE_RE = /^(?:商品名称|材料名称|产品名称|货品名称|名称及规格|名称规格|品名及规格|品名规格|品名|货名|材料|产品|项目)$/
const PAGE_TOTAL_LABEL_RE = /本页(?:金额|合计|小计)|分页(?:金额|合计|小计)|页(?:金额|合计|小计)/
const CUMULATIVE_TOTAL_LABEL_RE = /累计(?:金额|合计|总计|总金额)|总计金额|总金额/
const GENERIC_TOTAL_LABEL_RE = /合\s*计|总\s*计|应收|实收|^计\s*[:：]?$/
const SUBTOTAL_LABEL_RE = /小计/

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
    .replace(/^\s*#+\s*/, '')
    .replace(/[>`®™]/g, '')
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

function findLabeledOrderNo(lines: string[]): string {
  const label = /(?:送货单号|销售单号|出货单号|单据编号|单据号|单号|编号|No\.?)\s*(?:[:：]\s*)?([a-z0-9][a-z0-9\-/]{3,})/i
  for (const line of lines) {
    const match = line.match(label)
    if (match?.[1])
      return validOrderNumber(match[1])
  }
  return ''
}

function findOrderNo(lines: string[]): string {
  const labelled = findLabeledOrderNo(lines)
  if (labelled)
    return labelled

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
    .replace(SUPPLIER_LOGO_PREFIX_RE, '')
    .replace(/\s+/g, '')
    .replace(/^(?:供货单位|供方|销售方|供应商|公司名称|名称)[:：]?/, '')
    .replace(DOC_TYPE_TAIL_RE, '')
    .trim()
}

function findSupplier(lines: string[]): string {
  for (const raw of lines) {
    const normalized = stripInline(raw)
    const compact = normalized.replace(/\s+/g, '')
    if (!compact || BUYER_FIELD_RE.test(compact) || !COMPANY_HINT_RE.test(compact))
      continue
    const supplier = cleanSupplier(normalized)
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
    if (/名称及?规格|品名及?规格/.test(cell))
      columns.name ??= index
    else if (/备注|说明/.test(cell))
      columns.note ??= index
    else if (/规格|型号/.test(cell))
      columns.spec ??= index
    else if (/单价/.test(cell))
      columns.unitPrice ??= index
    else if (/数量|总数量/.test(cell))
      columns.quantity ??= index
    else if (/金额|总价|小计|人民币(?:大写)?/.test(cell))
      columns.total ??= index
    else if (/单位/.test(cell))
      columns.unit ??= index
    else if (/商品名称|材料名称|产品名称|货品名称|名称及?规格|品名及?规格|品名|货名|材料|项目/.test(cell) || cell === '产品')
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
  const unit = String(cells[offset + 1] ?? '').trim()
  const quantity = parseNumber(cells[offset + 2])
  const unitPrice = parseNumber(cells[offset + 3])
  const total = parseNumber(cells[offset + 4])
  if (!UNIT_RE.test(unit) || quantity == null || (unitPrice == null && total == null))
    return null
  return {
    name: offset,
    unit: offset + 1,
    quantity: offset + 2,
    unitPrice: offset + 3,
    total: offset + 4,
  }
}

function amountInText(value: string): number | null {
  const matches = [...value.matchAll(/[\d,]+(?:\.\d+)?/g)]
  const amount = matches.at(-1)?.[0]
  return amount ? parseNumber(amount) : null
}

function amountFollowingLabel(cells: string[], label: RegExp): number | null {
  for (const [index, cell] of cells.entries()) {
    if (!label.test(cell))
      continue
    const inlineAmount = amountInText(cell)
    if (inlineAmount != null)
      return inlineAmount
    let followingAmount: number | null = null
    for (const nextCell of cells.slice(index + 1)) {
      if (PAGE_TOTAL_LABEL_RE.test(nextCell)
        || CUMULATIVE_TOTAL_LABEL_RE.test(nextCell)
        || SUBTOTAL_LABEL_RE.test(nextCell)
        || GENERIC_TOTAL_LABEL_RE.test(nextCell)) {
        break
      }
      const amount = parseNumber(nextCell) ?? amountInText(nextCell)
      if (amount != null)
        followingAmount = amount
    }
    if (followingAmount != null)
      return followingAmount
  }
  return null
}

function aggregateTotalsFromRow(cells: string[]): ParsedAggregateTotals {
  const pageTotal = amountFollowingLabel(cells, PAGE_TOTAL_LABEL_RE)
  const cumulativeTotal = amountFollowingLabel(cells, CUMULATIVE_TOTAL_LABEL_RE)
  const genericCells = cells.filter(cell => !PAGE_TOTAL_LABEL_RE.test(cell) && !CUMULATIVE_TOTAL_LABEL_RE.test(cell))
  const subtotalTotal = amountFollowingLabel(genericCells, SUBTOTAL_LABEL_RE)
  let genericTotal = amountFollowingLabel(genericCells, GENERIC_TOTAL_LABEL_RE)
  if (pageTotal == null && cumulativeTotal == null && genericTotal == null && subtotalTotal == null) {
    for (const cell of [...cells].reverse()) {
      const amount = parseNumber(cell)
      if (amount != null) {
        genericTotal = amount
        break
      }
    }
  }
  return { pageTotal, cumulativeTotal, genericTotal, subtotalTotal }
}

function mergeAggregateTotals(current: ParsedAggregateTotals, incoming: ParsedAggregateTotals): ParsedAggregateTotals {
  return {
    pageTotal: incoming.pageTotal ?? current.pageTotal,
    cumulativeTotal: incoming.cumulativeTotal ?? current.cumulativeTotal,
    genericTotal: incoming.genericTotal ?? current.genericTotal,
    subtotalTotal: incoming.subtotalTotal ?? current.subtotalTotal,
  }
}

function valueAfterFieldLabel(rows: string[][], label: RegExp): string {
  for (const cells of rows) {
    for (const [index, rawCell] of cells.entries()) {
      const cell = rawCell.trim()
      if (!label.test(cell))
        continue
      const inlineValue = cell.replace(label, '').replace(/^\s*[:：]\s*/, '').trim()
      if (inlineValue)
        return inlineValue
      const nextValue = cells.slice(index + 1).find(value => value.trim())
      if (nextValue)
        return nextValue.trim()
    }
  }
  return ''
}

function fieldFormItems(table: DeliveryTable): ParsedItems | null {
  const rawName = valueAfterFieldLabel(table.rows, /^(?:服务项目|服务内容)$/)
  if (!rawName)
    return null
  const amountMatch = table.rawText.match(
    /人[民名]币[（(]?大写[）)]?[^¥￥]{0,80}[¥￥][\s:：]*([\d,]+(?:\.\d+)?)/,
  )
  const amount = amountMatch?.[1] ? parseNumber(amountMatch[1]) : null
  if (amount == null)
    return null
  const trailingAmount = rawName.match(/^(.*\S)(?:\s+[¥￥]?|[¥￥])([\d,]+(?:\.\d+)?)\s*$/)
  const name = trailingAmount?.[1] && parseNumber(trailingAmount[2]) === amount
    ? trailingAmount[1].trim()
    : rawName
  const note = valueAfterFieldLabel(table.rows, /^备注(?:内容)?(?=\s*[:：]|$)/)
    || table.rawText.match(/(?:备注(?:内容)?|说明) *[:：](.{1,80})$/)?.[1]?.trim()
    || ''
  const aggregateTotals = { pageTotal: null, cumulativeTotal: null, genericTotal: amount, subtotalTotal: null }
  return {
    items: [{
      name,
      spec: '',
      unit: '',
      quantity: null,
      unitPrice: null,
      total: amount,
      note,
    }],
    statedTotal: amount,
    aggregateTotals,
  }
}

function sequenceRange(table: DeliveryTable): { start: number | null, end: number | null } {
  const headerIndex = table.rows.findIndex(row => mapHeader(row) != null)
  const dataRows = headerIndex >= 0 ? table.rows.slice(headerIndex + 1) : table.rows
  const sequence = dataRows
    .filter(cells => !AGGREGATE_ROW_RE.test(cells.join('').replace(/\s/g, '')))
    .map(cells => String(cells[0] ?? '').trim())
    .filter(cell => /^\d+$/.test(cell))
    .map(Number)
  return {
    start: sequence[0] ?? null,
    end: sequence.at(-1) ?? null,
  }
}

function findPagination(lines: string[]): { pageNumber: number | null, pageCount: number | null } {
  const match = lines.join(' ').match(/第\s*(\d+)\s*页\s*[/／]\s*共\s*(\d+)\s*页/)
    || lines.join(' ').match(/第\s*(\d+)\s*页\s*共\s*(\d+)\s*页/)
  if (!match)
    return { pageNumber: null, pageCount: null }
  const pageNumber = Number(match[1])
  const pageCount = Number(match[2])
  if (!Number.isInteger(pageNumber) || !Number.isInteger(pageCount) || pageNumber < 1 || pageCount < pageNumber)
    return { pageNumber: null, pageCount: null }
  return { pageNumber, pageCount }
}

function tableItems(table: DeliveryTable): ParsedItems {
  const headerIndex = table.rows.findIndex(row => mapHeader(row) != null)
  const header = headerIndex >= 0
    ? mapHeader(table.rows[headerIndex]!)
    : inferredColumns(table.rows[0] ?? [])
  if (!header || header.name == null) {
    return fieldFormItems(table) ?? {
      items: [],
      statedTotal: null,
      aggregateTotals: { pageTotal: null, cumulativeTotal: null, genericTotal: null, subtotalTotal: null },
    }
  }

  const dataRows = headerIndex >= 0 ? table.rows.slice(headerIndex + 1) : table.rows
  const combinedNameSpec = headerIndex >= 0
    && /名称及?规格|品名及?规格/.test(String(table.rows[headerIndex]?.[header.name] ?? '').replace(/\s/g, ''))
  const items: ParsedDeliveryItem[] = []
  let aggregateTotals: ParsedAggregateTotals = {
    pageTotal: null,
    cumulativeTotal: null,
    genericTotal: null,
    subtotalTotal: null,
  }
  for (const cells of dataRows) {
    const joined = cells.join('').replace(/\s/g, '')
    if (!joined)
      continue
    if (AGGREGATE_ROW_RE.test(joined)) {
      aggregateTotals = mergeAggregateTotals(aggregateTotals, aggregateTotalsFromRow(cells))
      continue
    }
    if (mapHeader(cells) != null)
      continue

    const name = String(cells[header.name] ?? '').trim()
    if (!name
      || /^[-—\s]*$/.test(name)
      || ITEM_HEADER_VALUE_RE.test(name.replace(/\s/g, ''))
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

    if (spec && !unit && quantity == null && unitPrice == null && total == null && items.length) {
      const previous = items.at(-1)!
      previous.spec = [previous.spec, spec].filter(Boolean).join(' ')
      continue
    }
    if (combinedNameSpec
      && /^\d+$/.test(String(cells[0] ?? '').trim())
      && !unit
      && quantity == null
      && unitPrice == null
      && total == null
      && items.length) {
      const previous = items.at(-1)!
      previous.spec = [previous.spec, name].filter(Boolean).join(' ')
      continue
    }
    if (quantity == null && unitPrice == null && total == null && !UNIT_RE.test(unit))
      continue
    if (total == null && quantity != null && unitPrice != null)
      total = round2(quantity * unitPrice)
    if (/^\d+(?:\.\d+)?$/.test(name) || (unit && !UNIT_RE.test(unit)) || total == null)
      note = [note, 'OCR 低置信字段（待复核）'].filter(Boolean).join('；')
    if (quantity != null && unitPrice != null && total != null && Math.abs(round2(quantity * unitPrice) - total) > 0.01)
      note = [note, '金额与数量×单价不符（待复核）'].filter(Boolean).join('；')

    items.push({ name, spec, unit, quantity, unitPrice, total, note })
  }

  if (aggregateTotals.pageTotal == null) {
    const match = table.rawText.match(/(?:本页(?:金额|合计|小计)|分页(?:金额|合计|小计)|页(?:金额|合计|小计))[^\d¥￥]{0,20}[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
    aggregateTotals.pageTotal = match?.[1] ? parseNumber(match[1]) : null
  }
  if (aggregateTotals.cumulativeTotal == null) {
    const match = table.rawText.match(/(?:累计(?:金额|合计|总计|总金额)|总计金额|总金额)[^\d¥￥]{0,20}[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
    aggregateTotals.cumulativeTotal = match?.[1] ? parseNumber(match[1]) : null
  }
  if (aggregateTotals.subtotalTotal == null) {
    const match = table.rawText.match(/小计[^\d¥￥]{0,20}[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
    aggregateTotals.subtotalTotal = match?.[1] ? parseNumber(match[1]) : null
  }
  if (aggregateTotals.genericTotal == null) {
    const match = table.rawText.match(/(?:合\s*计|总\s*计|应收|实收)[^\d¥￥]{0,20}[¥￥]?\s*([\d,]+(?:\.\d+)?)/)
    aggregateTotals.genericTotal = match?.[1] ? parseNumber(match[1]) : null
  }
  const statedTotal = aggregateTotals.pageTotal
    ?? aggregateTotals.cumulativeTotal
    ?? aggregateTotals.genericTotal
    ?? aggregateTotals.subtotalTotal
  return { items, statedTotal, aggregateTotals }
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

function metadataCompatible(left: ParsedDeliveryDocumentPart, right: ParsedDeliveryDocumentPart): boolean {
  const fields: Array<keyof Pick<ParsedDeliveryDocument, 'supplier' | 'date' | 'siteText' | 'docType'>> = [
    'supplier',
    'date',
    'siteText',
    'docType',
  ]
  return fields.every((field) => {
    const leftValue = left[field]
    const rightValue = right[field]
    return !leftValue || !rightValue || leftValue === rightValue
  })
}

function appendDocumentPart(target: ParsedDeliveryDocumentPart, incoming: ParsedDeliveryDocumentPart): void {
  target.items.push(...incoming.items)
  target.sources.push(...incoming.sources)
  if (!target.supplier)
    target.supplier = incoming.supplier
  if (!target.date)
    target.date = incoming.date
  if (!target.orderNo || incoming.orderNo.length > target.orderNo.length)
    target.orderNo = incoming.orderNo
  if (!target.siteText)
    target.siteText = incoming.siteText
  if (!target.docType)
    target.docType = incoming.docType
  target.statedTotal = totalFromSources(target.sources)
  Object.assign(target, reviewSummary(target.items, target.statedTotal))
}

function sequentialTableContinuation(
  previous: ParsedDeliveryDocumentPart,
  current: ParsedDeliveryDocumentPart,
): boolean {
  const previousSource = previous.sources.at(-1)
  const currentSource = current.sources[0]
  if (!previousSource || !currentSource || previousSource.pageIndex !== currentSource.pageIndex)
    return false
  if (previousSource.sequenceEnd == null || currentSource.sequenceStart == null)
    return false
  if (currentSource.sequenceStart !== previousSource.sequenceEnd + 1)
    return false
  if (previous.orderNo && current.orderNo && previous.orderNo !== current.orderNo)
    return false
  return metadataCompatible(previous, current)
}

function documentFromTable(
  table: DeliveryTable,
  headerLines: string[],
  contextLines: string[],
  fileSupplier: string,
  pageIndex: number,
  tableIndex: number,
): ParsedDeliveryDocumentPart | null {
  const parsed = tableItems(table)
  if (!parsed.items.length)
    return null
  const tableLines = [
    ...table.rows.flatMap(row => row.flatMap(textLines)),
    ...textLines(table.rawText),
  ]
  const pagination = findPagination([...headerLines, ...contextLines])
  const sequence = sequenceRange(table)
  const summary = reviewSummary(parsed.items, parsed.statedTotal)
  return {
    supplier: findSupplier(headerLines)
      || findSupplier(tableLines)
      || findSupplier(contextLines)
      || fileSupplier,
    date: findDate(headerLines) || findDate(tableLines) || findDate(contextLines),
    orderNo: findOrderNo(headerLines) || findLabeledOrderNo(tableLines) || findOrderNo(contextLines),
    siteText: findSiteText(headerLines) || findSiteText(tableLines) || findSiteText(contextLines),
    docType: findDocType(headerLines) || findDocType(tableLines) || findDocType(contextLines),
    items: parsed.items,
    statedTotal: parsed.statedTotal,
    ...summary,
    headText: headerLines.join('\n'),
    sources: [{
      pageIndex,
      tableIndex,
      aggregateTotals: parsed.aggregateTotals,
      sequenceStart: sequence.start,
      sequenceEnd: sequence.end,
      pageNumber: pagination.pageNumber,
      pageCount: pagination.pageCount,
    }],
  }
}

function documentsFromHtmlPage(
  markdown: string,
  fileSupplier: string,
  pageIndex: number,
): ParsedDeliveryDocumentPart[] {
  const tables = htmlTables(markdown)
  if (!tables.length)
    return []
  const pageLines = textLines(markdown.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ' '))
  const documents: ParsedDeliveryDocumentPart[] = []
  let cursor = 0
  for (const [tableIndex, entry] of tables.entries()) {
    const headerLines = textLines(markdown.slice(cursor, entry.start))
    const document = documentFromTable(entry.table, headerLines, pageLines, fileSupplier, pageIndex, tableIndex)
    const previous = documents.at(-1)
    if (document && previous && sequentialTableContinuation(previous, document))
      appendDocumentPart(previous, document)
    else if (document)
      documents.push(document)
    cursor = entry.end
  }
  return documents
}

function documentsFromMarkdownPage(
  markdown: string,
  fileSupplier: string,
  pageIndex: number,
): ParsedDeliveryDocumentPart[] {
  const documents: ParsedDeliveryDocumentPart[] = []
  const pageLines = textLines(markdown.replace(/^\s*\|.*\|\s*$/gm, ' '))
  const pendingText: string[] = []
  let rows: string[][] = []
  let tableIndex = 0

  const flush = () => {
    if (!rows.length)
      return
    const table = { rows, rawText: rows.flat().join(' ') }
    const document = documentFromTable(table, [...pendingText], pageLines, fileSupplier, pageIndex, tableIndex)
    const previous = documents.at(-1)
    if (document && previous && sequentialTableContinuation(previous, document))
      appendDocumentPart(previous, document)
    else if (document)
      documents.push(document)
    rows = []
    pendingText.length = 0
    tableIndex += 1
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

function totalFromSources(sources: ParsedDocumentSource[]): number | null {
  if (sources.length === 1) {
    const totals = sources[0]!.aggregateTotals
    return totals.pageTotal ?? totals.cumulativeTotal ?? totals.genericTotal ?? totals.subtotalTotal
  }
  const ordered = [...sources].sort((left, right) =>
    left.pageIndex - right.pageIndex || left.tableIndex - right.tableIndex)
  const latestTotal = (field: keyof ParsedAggregateTotals): number | null => {
    for (const source of [...ordered].reverse()) {
      const value = source.aggregateTotals[field]
      if (value != null)
        return value
    }
    return null
  }
  const pageIndexes = new Set(ordered.map(source => source.pageIndex))
  const latestCumulative = latestTotal('cumulativeTotal')
  if (latestCumulative != null)
    return latestCumulative
  if (pageIndexes.size === 1) {
    if (ordered.every(source => source.aggregateTotals.pageTotal != null)) {
      return round2(ordered.reduce(
        (sum, source) => sum + source.aggregateTotals.pageTotal!,
        0,
      ))
    }
    const latestGeneric = latestTotal('genericTotal')
    if (latestGeneric != null)
      return latestGeneric
    if (ordered.every(source => source.aggregateTotals.subtotalTotal != null)) {
      return round2(ordered.reduce(
        (sum, source) => sum + source.aggregateTotals.subtotalTotal!,
        0,
      ))
    }
    return latestTotal('pageTotal') ?? latestTotal('subtotalTotal')
  }
  if (ordered.every(source => source.aggregateTotals.pageTotal != null)) {
    return round2(ordered.reduce(
      (sum, source) => sum + source.aggregateTotals.pageTotal!,
      0,
    ))
  }
  const latestGeneric = latestTotal('genericTotal')
  if (latestGeneric != null)
    return latestGeneric
  if (ordered.every(source => source.aggregateTotals.subtotalTotal != null)) {
    return round2(ordered.reduce(
      (sum, source) => sum + source.aggregateTotals.subtotalTotal!,
      0,
    ))
  }
  return latestTotal('subtotalTotal')
}

function differsByAtMostOneCharacter(left: string, right: string): boolean {
  if (left === right)
    return true
  if (Math.abs(left.length - right.length) > 1)
    return false
  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index])
        differences += 1
      if (differences > 1)
        return false
    }
    return true
  }
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left]
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1
      longIndex += 1
      continue
    }
    if (skipped)
      return false
    skipped = true
    longIndex += 1
  }
  return true
}

function fuzzyPaginatedOrderMatch(
  candidate: ParsedDeliveryDocumentPart,
  document: ParsedDeliveryDocumentPart,
): boolean {
  if (!candidate.orderNo || !document.orderNo || !differsByAtMostOneCharacter(candidate.orderNo, document.orderNo))
    return false
  if (!candidate.supplier || candidate.supplier !== document.supplier)
    return false
  if (!candidate.date || candidate.date !== document.date)
    return false
  if (!candidate.docType || candidate.docType !== document.docType)
    return false
  const incoming = document.sources[0]
  if (!incoming?.pageNumber || !incoming.pageCount || incoming.pageCount < 2)
    return false
  return candidate.sources.some(source =>
    source.pageCount === incoming.pageCount
    && source.pageNumber != null
    && source.pageNumber !== incoming.pageNumber)
}

function hasNewLogicalPage(
  candidate: ParsedDeliveryDocumentPart,
  document: ParsedDeliveryDocumentPart,
): boolean {
  const incoming = document.sources[0]
  if (incoming?.pageNumber == null || incoming.pageCount == null)
    return true
  const existingPagination = candidate.sources.filter(source => source.pageNumber != null && source.pageCount != null)
  if (existingPagination.some(source => source.pageCount !== incoming.pageCount))
    return false
  return !existingPagination.some(source => source.pageNumber === incoming.pageNumber)
}

function mergeSameOrderDocuments(documents: ParsedDeliveryDocumentPart[]): ParsedDeliveryDocument[] {
  const output: ParsedDeliveryDocumentPart[] = []
  for (const document of documents) {
    const sourcePageIndex = document.sources[0]?.pageIndex
    const existing = document.orderNo
      ? output.find(candidate =>
          metadataCompatible(candidate, document)
          && (candidate.orderNo === document.orderNo || fuzzyPaginatedOrderMatch(candidate, document))
          && hasNewLogicalPage(candidate, document)
          && !candidate.sources.some(source => source.pageIndex === sourcePageIndex))
      : undefined
    if (!existing) {
      output.push(document)
      continue
    }
    appendDocumentPart(existing, document)
  }
  return output.map(({ sources: _sources, ...document }) => document)
}

/** PaddleOCR-VL 的 Markdown/HTML 版面结果 → 可人工校对的送货单字段与材料行。 */
export function parseDeliveryMarkdown(markdownPages: string[]): ParsedDeliveryResult {
  const pages = markdownPages.map(page => String(page || ''))
  const withoutTables = pages.map(page => page.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, ' '))
  const fileLines = withoutTables.flatMap(textLines)
  const fileSupplier = findSupplier(fileLines)
  const documents = pages.flatMap((page, pageIndex) => {
    const htmlDocuments = documentsFromHtmlPage(page, fileSupplier, pageIndex)
    return htmlDocuments.length
      ? htmlDocuments
      : documentsFromMarkdownPage(page, fileSupplier, pageIndex)
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
      sources: [{
        pageIndex: 0,
        tableIndex: 0,
        aggregateTotals: { pageTotal: null, cumulativeTotal: null, genericTotal: null, subtotalTotal: null },
        sequenceStart: null,
        sequenceEnd: null,
        pageNumber: null,
        pageCount: null,
      }],
    })
  }

  const mergedDocuments = mergeSameOrderDocuments(documents)
  return {
    supplier: fileSupplier || mergedDocuments.find(document => document.supplier)?.supplier || '',
    docs: mergedDocuments,
    rawText: fileLines.join('\n'),
  }
}
