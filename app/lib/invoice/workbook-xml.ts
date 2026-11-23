import type { SaxesTagNS } from 'saxes'
import type { WorkBook } from 'xlsx'
import { SaxesParser } from 'saxes'
import { INVOICE_WORKBOOK_LIMIT_MESSAGE, INVOICE_WORKBOOK_MAX_COLUMNS, INVOICE_WORKBOOK_MAX_ROWS, INVOICE_WORKBOOK_MAX_SHEETS, InvoiceWorkbookLimitError } from './workbook-limits'

const sheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'
const workbookPart = 'xl/workbook.xml'
const worksheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const xmlPart = /\.(?:xml|rels|vml)$/i
const xmlFailure = '工作簿 XML 结构或内容无法可靠核验，请另存为 .xlsx 后重试。'
export const INVOICE_WORKBOOK_VERIFICATION_UNAVAILABLE = '工作簿安全核验暂不可用，请保留原文件并稍后重试。'

export class InvoiceWorkbookXmlError extends Error {}

function invalid(): never {
  throw new InvoiceWorkbookXmlError(xmlFailure)
}

interface XmlEvents {
  open: (tag: SaxesTagNS, ancestors: readonly SaxesTagNS[]) => void
  close?: (tag: SaxesTagNS) => void
  text?: (text: string) => void
}

/** 在 SheetJS 的兼容读取之前严格解析 XML。限定为 OOXML 的 UTF-8、无 DTD 文件。 */
function readXml(bytes: Uint8Array, active: () => void, events?: XmlEvents) {
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true })
  const stack: SaxesTagNS[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  parser.on('error', invalid)
  parser.on('doctype', invalid)
  parser.on('processinginstruction', invalid)
  parser.on('cdata', invalid)
  parser.on('comment', (text) => {
    if (text.includes('<'))
      invalid()
  })
  parser.on('xmldecl', ({ version, encoding }) => {
    if (version !== '1.0' || (encoding && !/^utf-8$/i.test(encoding)))
      invalid()
  })
  parser.on('opentag', (tag) => {
    if (stack.length >= 128)
      invalid()
    events?.open(tag, stack)
    stack.push(tag)
  })
  parser.on('closetag', (tag) => {
    stack.pop()
    events?.close?.(tag)
  })
  if (events?.text)
    parser.on('text', events.text)
  for (let index = 0; index < bytes.length; index += 65536) {
    active()
    let chunk: string
    try {
      chunk = decoder.decode(bytes.subarray(index, index + 65536), { stream: true })
    }
    catch { return invalid() }
    parser.write(chunk)
  }
  let tail: string
  try {
    tail = decoder.decode()
  }
  catch { return invalid() }
  parser.write(tail).close()
}

function attr(tag: SaxesTagNS, key: string): string {
  return tag.attributes[key]?.value ?? ''
}

function root(tag: SaxesTagNS, namespace: string, local: string) {
  if (tag.uri !== namespace || tag.local !== local)
    invalid()
}

function partPath(name: string) {
  if (!name || name.startsWith('/') || /[\\%?#]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32)
    || name.toLowerCase().startsWith('root entry/') || name.split('/').some(part => !part || part === '.' || part === '..')) {
    return invalid()
  }
  return name.toLowerCase()
}

/** XML 中的地址必须可完整解释，避免工作表正文在兼容解析时被截断。 */
function cellAddress(address: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address)
  if (!match)
    return invalid()
  let column = 0
  for (const letter of match[1]!)
    column = column * 26 + letter.charCodeAt(0) - 64
  const row = Number(match[2])
  if (row > INVOICE_WORKBOOK_MAX_ROWS || column > INVOICE_WORKBOOK_MAX_COLUMNS)
    throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
  return { row, column }
}

function range(ref: string) {
  const [start, end, ...rest] = ref.split(':')
  if (rest.length || !start)
    return invalid()
  const first = cellAddress(start)
  const last = cellAddress(end ?? start)
  if (last.row < first.row || last.column < first.column)
    return invalid()
  return { first, last }
}

type FormulaCache = 'missing-cache' | 'invalid' | 'present'

function formulaCache(type: string, value: string | undefined): FormulaCache {
  if (!value?.trim())
    return 'missing-cache'
  if (type === 'n')
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) ? 'present' : 'invalid'
  if (type === 'b')
    return value === '0' || value === '1' ? 'present' : 'invalid'
  return type === 'str' || (type === 's' && /^\d+$/.test(value)) ? 'present' : 'invalid'
}

function readWorksheetXml(bytes: Uint8Array, active: () => void) {
  const formulas = new Map<string, FormulaCache>()
  const merged = new Uint8Array(INVOICE_WORKBOOK_MAX_ROWS * INVOICE_WORKBOOK_MAX_COLUMNS)
  const structural = new Set(['dimension', 'sheetData', 'row', 'c', 'f', 'v', 'mergeCells', 'mergeCell'])
  const seenSections = new Set<string>()
  let row = 0
  let column = 0
  let cell: { address: string, type: string, formula: boolean, cache?: string } | undefined
  let readingCache = false
  readXml(bytes, active, {
    open(tag, ancestors) {
      if (!ancestors.length)
        return root(tag, sheetNamespace, 'worksheet')
      const parent = ancestors.at(-1)?.local
      if (!structural.has(tag.local)) {
        if (parent === 'f' || parent === 'v')
          invalid()
        return
      }
      if (tag.uri !== sheetNamespace)
        invalid()
      if (tag.local === 'dimension' || tag.local === 'sheetData' || tag.local === 'mergeCells') {
        if (parent !== 'worksheet' || seenSections.has(tag.local))
          invalid()
        seenSections.add(tag.local)
        if (tag.local === 'dimension')
          range(attr(tag, 'ref'))
      }
      if (tag.local === 'row') {
        const ref = attr(tag, 'r')
        const index = cellAddress(`A${ref}`).row
        if (parent !== 'sheetData' || index <= row)
          invalid()
        row = index
        column = 0
      }
      if (tag.local === 'c') {
        const address = attr(tag, 'r')
        const position = cellAddress(address)
        if (parent !== 'row' || cell || position.row !== row || position.column <= column)
          invalid()
        column = position.column
        cell = { address, type: attr(tag, 't') || 'n', formula: false }
      }
      if (tag.local === 'f') {
        if (parent !== 'c' || !cell || cell.formula || cell.cache !== undefined)
          return invalid()
        cell.formula = true
        const ref = attr(tag, 'ref')
        if (ref)
          range(ref)
      }
      if (tag.local === 'v') {
        if (parent !== 'c' || !cell || cell.cache !== undefined)
          return invalid()
        cell.cache = ''
        readingCache = cell.formula
      }
      if (tag.local === 'mergeCell') {
        if (parent !== 'mergeCells')
          invalid()
        const { first, last } = range(attr(tag, 'ref'))
        for (let r = first.row - 1; r < last.row; r++) {
          for (let c = first.column - 1; c < last.column; c++) {
            const index = r * INVOICE_WORKBOOK_MAX_COLUMNS + c
            if (merged[index])
              throw new InvoiceWorkbookLimitError('工作簿合并单元格重叠，无法可靠核验。')
            merged[index] = 1
          }
        }
      }
    },
    close(tag) {
      if (tag.local === 'v')
        readingCache = false
      if (tag.local === 'c' && cell) {
        if (cell.formula)
          formulas.set(cell.address, formulaCache(cell.type, cell.cache))
        cell = undefined
      }
    },
    text(text) {
      if (readingCache && cell)
        cell.cache += text
    },
  })
  if (!seenSections.has('sheetData'))
    invalid()
  return formulas
}

export interface InvoiceWorkbookXmlEntry { name: string, bytes: Uint8Array }

export function verifyInvoiceWorkbookXml(entries: readonly InvoiceWorkbookXmlEntry[], active: () => void = () => {}) {
  const parts = new Map(entries.filter(entry => !entry.name.endsWith('/')).map(entry => [partPath(entry.name), entry.bytes]))
  const verified = new Set<string>()
  function parsePart(path: string, events?: XmlEvents) {
    const bytes = parts.get(path)
    if (!bytes)
      return invalid()
    readXml(bytes, active, events)
    verified.add(path)
  }

  const overrides = new Map<string, string>()
  parsePart('[content_types].xml', {
    open(tag, ancestors) {
      if (!ancestors.length)
        return root(tag, contentTypes, 'Types')
      if (ancestors.length !== 1 || tag.uri !== contentTypes || !['Default', 'Override'].includes(tag.local))
        return invalid()
      if (tag.local === 'Override') {
        const name = attr(tag, 'PartName')
        const type = attr(tag, 'ContentType')
        const path = partPath(name.slice(1))
        if (!name.startsWith('/') || !xmlPart.test(path) || !parts.has(path) || !type.endsWith('+xml') || overrides.has(path))
          return invalid()
        overrides.set(path, type)
      }
    },
  })
  if (overrides.get(workbookPart) !== workbookType || [...overrides].some(([path, type]) => path !== workbookPart && /(?:sheet|template|addin)\.main\+xml$/i.test(type)))
    return invalid()

  const relationships = new Map<string, string>()
  const relationshipIds = new Set<string>()
  parsePart('xl/_rels/workbook.xml.rels', {
    open(tag, ancestors) {
      if (!ancestors.length)
        return root(tag, packageRelationships, 'Relationships')
      if (ancestors.length !== 1 || tag.uri !== packageRelationships || tag.local !== 'Relationship')
        return invalid()
      const id = attr(tag, 'Id')
      if (!id || relationshipIds.has(id))
        return invalid()
      relationshipIds.add(id)
      if (attr(tag, 'Type') !== `${officeRelationships}/worksheet`)
        return
      const target = attr(tag, 'Target')
      const mode = attr(tag, 'TargetMode')
      const path = partPath(target.startsWith('/') ? target.slice(1) : `xl/${target}`)
      if ((mode && mode !== 'Internal') || !/^xl\/worksheets\/[^/]+\.xml$/.test(path) || overrides.get(path) !== worksheetType)
        return invalid()
      relationships.set(id, path)
    },
  })

  const sheets = new Map<string, Map<string, FormulaCache>>()
  const names = new Set<string>()
  parsePart(workbookPart, {
    open(tag, ancestors) {
      if (!ancestors.length)
        return root(tag, sheetNamespace, 'workbook')
      if (tag.local !== 'sheet')
        return
      const name = attr(tag, 'name')
      const id = Object.values(tag.attributes).find(attribute => attribute.uri === officeRelationships && attribute.local === 'id')?.value
      const path = id && relationships.get(id)
      const sheet = path ? parts.get(path) : undefined
      if (tag.uri !== sheetNamespace || ancestors.length !== 2 || ancestors[1]?.local !== 'sheets' || ancestors[1].uri !== sheetNamespace
        || !sheet || !path || verified.has(path) || !name.trim() || names.has(name.toLowerCase())) {
        return invalid()
      }
      if (sheets.size >= INVOICE_WORKBOOK_MAX_SHEETS)
        throw new InvoiceWorkbookLimitError(INVOICE_WORKBOOK_LIMIT_MESSAGE)
      names.add(name.toLowerCase())
      sheets.set(name, readWorksheetXml(sheet, active))
      verified.add(path)
    },
  })
  if (!sheets.size || sheets.size !== relationships.size)
    return invalid()
  for (const path of parts.keys()) {
    if (xmlPart.test(path) && !verified.has(path))
      parsePart(path)
  }
  return sheets
}

/** 缓存状态取自原 XML，不能把兼容读取器生成的占位零当作凭证。 */
export function applyVerifiedInvoiceWorkbookFormulas(workbook: WorkBook, verified: ReturnType<typeof verifyInvoiceWorkbookXml>, sheetName?: string) {
  const names = [...verified.keys()]
  if (workbook.SheetNames.length !== names.length || workbook.SheetNames.some((name, index) => name !== names[index]))
    return invalid()
  for (const name of sheetName === undefined ? names : [sheetName]) {
    const sheet = workbook.Sheets[name]
    const formulas = verified.get(name)
    if (!sheet || !formulas)
      return invalid()
    for (const [address, cache] of formulas) {
      const cell = sheet[address]
      if (!cell?.f)
        return invalid()
      if (cache === 'missing-cache')
        sheet[address] = { ...cell, t: 'z', v: undefined, w: undefined }
      else if (cache === 'invalid' && cell.t !== 'e')
        sheet[address] = { ...cell, t: 'e', v: undefined, w: undefined }
      else if (cache === 'present' && (cell.t === 'z' || cell.v == null || (typeof cell.v === 'number' && !Number.isFinite(cell.v))))
        return invalid()
    }
  }
}
