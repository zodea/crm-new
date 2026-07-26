import type { SoftDb } from '~/lib/db/soft-delete'
import * as XLSX from 'xlsx'
import { logCreate, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export type BoqFormatClass = 'A' | 'B' | 'C' | 'D' | 'E'

export interface BoqParsedSourceRow {
  sourceRow: number
  values: Readonly<Record<string, unknown>>
}

export interface BoqParsedSheet {
  name: string
  headerRow: number
  columns: readonly string[]
  rows: readonly BoqParsedSourceRow[]
}

export interface BoqParsedWorkbook {
  fileName: string
  formatClass: BoqFormatClass
  formatLabel: string
  sheets: readonly BoqParsedSheet[]
}

export type BoqImportField
  = | 'section'
    | 'trade'
    | 'itemCode'
    | 'itemName'
    | 'unit'
    | 'qty'
    | 'unitPrice'
    | 'amount'
    | 'building'
    | 'unitType'
    | 'multiplier'
    | 'room'
    | 'floorZone'
    | 'spec'
    | 'taxRate'
    | 'ownerSupplied'

export type BoqColumnMapping = Readonly<Partial<Record<BoqImportField, string>>>

export interface BoqImportRow {
  section: string
  trade: string
  itemCode: string
  itemName: string
  unit: string
  qty: number
  unitPrice: number
  amount: number
  building: string
  unitType: string
  multiplier: number | null
  room: string
  floorZone: string
  spec: string
  taxRate: number | null
  ownerSupplied: boolean
  sourceSheet: string
  sourceRow: number
}

export interface PersistBoqImportInput {
  projectId: string
  contractId: string
  fileName: string
  filePath?: string
  formatClass: BoqFormatClass
  note?: string
  rows: readonly BoqImportRow[]
}

export interface PersistBoqImportResult {
  fileId: string
  lineCount: number
  linkedTemplateLineCount: number
  logIds: readonly string[]
}

const FORMAT_LABELS: Record<BoqFormatClass, string> = {
  A: '户型矩阵招标型',
  B: '章节树户内合同型',
  C: '结构化数字清单型',
  D: '楼层分部国标型',
  E: '单价库型',
}

const FIELD_ALIASES: Record<BoqImportField, readonly string[]> = {
  section: ['分部', '章节', '专业', '分部工程'],
  trade: ['工种', '施工工种'],
  itemCode: ['分项编码', '项目编码', '清单编码', '编码'],
  itemName: ['分项名称', '项目名称', '清单名称', '名称'],
  unit: ['单位', '计量单位'],
  qty: ['工程量', '数量', '合同量', '清单量'],
  unitPrice: ['不含税单价', '合同单价', '综合单价', '单价'],
  amount: ['合价', '金额', '合同金额'],
  building: ['楼栋', '栋号'],
  unitType: ['户型', '户型编码'],
  multiplier: ['套数', '倍数', '户数'],
  room: ['房间', '部位', '位置'],
  floorZone: ['楼层', '层区', '楼层层区'],
  spec: ['特征描述', '项目特征', '规格', '做法'],
  taxRate: ['税率'],
  ownerSupplied: ['甲供', '甲供材', '采购方式'],
}

function normalized(value: unknown): string {
  return value == null ? '' : String(value).trim().toLowerCase().replace(/\s+/g, '')
}

const KNOWN_HEADERS = new Set(Object.values(FIELD_ALIASES).flat().map(normalized))

function uniqueColumns(values: readonly unknown[]): string[] {
  const counts = new Map<string, number>()
  return values.map((value, index) => {
    const raw = String(value ?? '').trim() || `未命名列${index + 1}`
    const count = counts.get(raw) ?? 0
    counts.set(raw, count + 1)
    return count === 0 ? raw : `${raw}_${count}`
  })
}

function headerScore(row: readonly unknown[]): number {
  return row.reduce<number>((score, value) => score + Number(KNOWN_HEADERS.has(normalized(value))), 0)
}

function parseSheet(name: string, worksheet: XLSX.WorkSheet): BoqParsedSheet {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: '',
  })
  let headerIndex = -1
  let bestScore = 0
  for (const [index, row] of matrix.slice(0, 20).entries()) {
    const score = headerScore(row)
    if (score > bestScore) {
      bestScore = score
      headerIndex = index
    }
  }
  if (headerIndex < 0 || bestScore < 2)
    throw new Error(`工作表「${name}」前 20 行未识别到清单表头`)
  const columns = uniqueColumns(matrix[headerIndex] ?? [])
  const rows = matrix
    .slice(headerIndex + 1)
    .map((cells, offset) => ({
      sourceRow: headerIndex + offset + 2,
      values: Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ''])),
    }))
    .filter(row => Object.values(row.values).some(value => String(value ?? '').trim()))
  return {
    name,
    headerRow: headerIndex + 1,
    columns,
    rows,
  }
}

function detectFormat(
  fileName: string,
  workbook: XLSX.WorkBook,
  sheets: readonly BoqParsedSheet[],
): BoqFormatClass {
  const haystack = [
    fileName,
    ...workbook.SheetNames,
    ...sheets.flatMap(sheet => sheet.rows.slice(0, 30).flatMap(row => Object.values(row.values))),
  ].join(' ')
  if (/零星|基准价|单价库/.test(haystack))
    return 'E'
  if (/BQITEM|BQDESC|GUID|A1章/i.test(haystack))
    return 'C'
  if (/于[^，。；\s]{1,12}(?:[房厅厨卫]|阳台)/.test(haystack))
    return 'B'
  if (sheets.some(sheet => sheet.columns.some(column => /户型|套数|倍数/.test(column))))
    return 'A'
  if (/楼层|负\d+层|首层/.test(haystack))
    return 'D'
  return 'D'
}

export function parseBoqWorkbook(buffer: ArrayBuffer, fileName: string): BoqParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: 'array', codepage: 65001 })
  if (!workbook.SheetNames.length)
    throw new Error('清单文件没有工作表')
  const sheets = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]
    if (!worksheet)
      throw new Error(`工作表「${name}」读取失败`)
    return parseSheet(name, worksheet)
  })
  const formatClass = detectFormat(fileName, workbook, sheets)
  return {
    fileName,
    formatClass,
    formatLabel: FORMAT_LABELS[formatClass],
    sheets,
  }
}

export function autoMapBoqColumns(columns: readonly string[]): Partial<Record<BoqImportField, string>> {
  const mapping: Partial<Record<BoqImportField, string>> = {}
  const claimed = new Set<string>()
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [BoqImportField, readonly string[]][]) {
    const exact = columns.find(column => (
      !claimed.has(column) && aliases.some(alias => normalized(alias) === normalized(column))
    ))
    if (exact) {
      mapping[field] = exact
      claimed.add(exact)
    }
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [BoqImportField, readonly string[]][]) {
    if (mapping[field])
      continue
    const suggested = columns.find((column) => {
      if (claimed.has(column))
        return false
      const header = normalized(column)
      return aliases.some((alias) => {
        const candidate = normalized(alias)
        return candidate.length >= 2 && (header.includes(candidate) || candidate.includes(header))
      })
    })
    if (suggested) {
      mapping[field] = suggested
      claimed.add(suggested)
    }
  }
  return mapping
}

function text(row: BoqParsedSourceRow, column: string | undefined): string {
  return column ? String(row.values[column] ?? '').trim() : ''
}

function numberOrNull(value: string): number | null {
  if (!value)
    return null
  const cleaned = value.replace(/[,，￥¥\s]/g, '').replace(/%$/, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function requiredNumber(value: string, label: string, sourceRow: number): number {
  const parsed = numberOrNull(value)
  if (parsed == null)
    throw new Error(`第 ${sourceRow} 行「${label}」不是有效数字`)
  return parsed
}

export function buildBoqImportRows(
  sheet: BoqParsedSheet,
  mapping: BoqColumnMapping,
): BoqImportRow[] {
  if (!mapping.itemName || !mapping.qty || !mapping.unitPrice)
    throw new Error('分项名称、工程量、合同单价是导入必填映射')
  return sheet.rows.flatMap((source) => {
    const itemName = text(source, mapping.itemName)
    if (!itemName || /^(?:合计|小计|总计|备注)$/.test(itemName))
      return []
    const qty = requiredNumber(text(source, mapping.qty), '工程量', source.sourceRow)
    const unitPrice = requiredNumber(text(source, mapping.unitPrice), '合同单价', source.sourceRow)
    if (qty < 0 || unitPrice < 0)
      throw new Error(`第 ${source.sourceRow} 行工程量与合同单价不能为负数`)
    const amount = numberOrNull(text(source, mapping.amount)) ?? qty * unitPrice
    const ownerSupplied = /^(?:是|甲供|甲供材|1|true|yes)$/i.test(text(source, mapping.ownerSupplied))
    return [{
      section: text(source, mapping.section),
      trade: text(source, mapping.trade),
      itemCode: text(source, mapping.itemCode),
      itemName,
      unit: text(source, mapping.unit),
      qty,
      unitPrice,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      building: text(source, mapping.building),
      unitType: text(source, mapping.unitType),
      multiplier: numberOrNull(text(source, mapping.multiplier)),
      room: text(source, mapping.room),
      floorZone: text(source, mapping.floorZone),
      spec: text(source, mapping.spec),
      taxRate: numberOrNull(text(source, mapping.taxRate)),
      ownerSupplied,
      sourceSheet: sheet.name,
      sourceRow: source.sourceRow,
    }]
  })
}

export async function persistBoqImport(
  db: SoftDb,
  input: PersistBoqImportInput,
): Promise<PersistBoqImportResult> {
  if (!input.rows.length)
    throw new Error('没有可导入的清单行')
  const [contract] = await db.select<{ id: string }>(
    selectVisibleSql(
      'contracts',
      `AND id = ? AND project_id = ? AND kind = '施工'`,
    ),
    [input.contractId, input.projectId],
  )
  if (!contract)
    throw new Error('施工合同不存在、已删除或不属于所选项目')
  const items = await db.select<{ id: string, code: string, name: string }>(
    selectVisibleSql('items', 'AND project_id = ?'),
    [input.projectId],
  )
  const itemByCode = new Map(items.map(item => [item.code.trim().toLowerCase(), item.id]))
  const itemByName = new Map(items.map(item => [item.name.trim(), item.id]))
  const [order] = await db.select<{ next_order: number }>(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order
     FROM boq_lines
     WHERE contract_id = ? AND deleted_at IS NULL`,
    [input.contractId],
  )
  let nextSortOrder = Number(order?.next_order) || 10
  const fileId = generateId('boq_file')
  const logIds: string[] = []
  await db.execute(
    `INSERT INTO boq_files
      (id, contract_id, file_name, file_path, format_class, parse_status, line_count, note)
     VALUES (?, ?, ?, ?, ?, 'parsed', ?, ?)`,
    [
      fileId,
      input.contractId,
      input.fileName.trim(),
      input.filePath?.trim() ?? '',
      input.formatClass,
      input.rows.length,
      input.note?.trim() ?? '',
    ],
  )
  const fileLogId = await logCreate(db, 'boq_files', fileId)
  if (fileLogId)
    logIds.push(fileLogId)

  let linkedTemplateLineCount = 0
  for (const row of input.rows) {
    const lineId = generateId('boq_line')
    const itemId = (
      itemByCode.get(row.itemCode.trim().toLowerCase())
      ?? itemByName.get(row.itemName.trim())
      ?? null
    )
    const traceKey = `${input.fileName}·${row.sourceSheet}·${row.sourceRow}`
    await db.execute(
      `INSERT INTO boq_lines
        (id, boq_file_id, project_id, contract_id, item_id, section, trade, item_name,
         unit, qty, unit_price, amount, trace_key, source_sheet, source_row,
         recognized_qty, recognized_unit_price, building, unit_type, multiplier, room,
         floor_zone, spec, tax_rate, owner_supplied, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lineId,
        fileId,
        input.projectId,
        input.contractId,
        itemId,
        row.section,
        row.trade,
        row.itemName,
        row.unit,
        row.qty,
        row.unitPrice,
        row.amount,
        traceKey,
        row.sourceSheet,
        row.sourceRow,
        row.qty,
        row.unitPrice,
        row.building,
        row.unitType,
        row.multiplier,
        row.room,
        row.floorZone,
        row.spec,
        row.taxRate,
        Number(row.ownerSupplied),
        nextSortOrder,
      ],
    )
    nextSortOrder += 10
    const lineLogId = await logCreate(db, 'boq_lines', lineId)
    if (lineLogId)
      logIds.push(lineLogId)

    if (itemId && row.unitType) {
      const templateLines = await db.select<{ id: string }>(`
        SELECT hti.id
        FROM house_type_template_items hti
        JOIN rooms room_row ON room_row.id = hti.room_id
        JOIN house_type_templates template ON template.id = room_row.template_id
        WHERE hti.deleted_at IS NULL
          AND room_row.deleted_at IS NULL
          AND template.deleted_at IS NULL
          AND template.project_id = ?
          AND template.code = ?
          AND hti.item_id = ?
      `, [input.projectId, row.unitType, itemId])
      for (const templateLine of templateLines) {
        const templateLogId = await withUpdateLog(
          db,
          'house_type_template_items',
          templateLine.id,
          () => db.execute(
            `UPDATE house_type_template_items
             SET boq_line_id = ?,
                 recognized_contract_qty = ?,
                 contract_qty = ?,
                 updated_at = datetime('now')
             WHERE id = ?`,
            [lineId, row.qty, row.qty, templateLine.id],
          ),
        )
        if (templateLogId)
          logIds.push(templateLogId)
        linkedTemplateLineCount += 1
      }
    }
  }
  return {
    fileId,
    lineCount: input.rows.length,
    linkedTemplateLineCount,
    logIds,
  }
}
