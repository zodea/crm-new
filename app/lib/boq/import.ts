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
  ignoredSheets: readonly string[]
}

export type BoqImportField
  = | 'section'
    | 'trade'
    | 'itemCode'
    | 'itemName'
    | 'unit'
    | 'qty'
    | 'totalQty'
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
    | 'rowType'

export type BoqColumnMapping = Readonly<Partial<Record<BoqImportField, string>>>

export interface BoqImportRow {
  section: string
  trade: string
  itemCode: string
  itemName: string
  unit: string
  qty: number
  totalQty: number | null
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
  unitPriceCount: number
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
  totalQty: ['总工程量', '总量', '合计量'],
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
  rowType: ['行类型', '数据类型', '记录类型'],
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

function fillMergedCells(matrix: unknown[][], worksheet: XLSX.WorkSheet): void {
  for (const merge of worksheet['!merges'] ?? []) {
    const value = matrix[merge.s.r]?.[merge.s.c] ?? ''
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      matrix[row] ??= []
      for (let column = merge.s.c; column <= merge.e.c; column += 1)
        matrix[row]![column] = value
    }
  }
}

function forwardFilled(row: readonly unknown[]): string[] {
  let previous = ''
  return row.map((value) => {
    const current = String(value ?? '').trim()
    if (current)
      previous = current
    return current || previous
  })
}

function aliasesMatch(value: string, field: BoqImportField): boolean {
  const header = normalized(value)
  return FIELD_ALIASES[field].some((alias) => {
    const candidate = normalized(alias)
    return header === candidate || header.includes(candidate)
  })
}

function matrixHeaderLabel(parts: readonly string[]): string {
  return [...new Set(parts.filter(Boolean))].join(' / ')
}

function unitTypeFromHeader(parts: readonly string[]): string {
  const ignored = new Set(Object.values(FIELD_ALIASES).flat().map(normalized))
  const candidate = [...parts]
    .reverse()
    .find(part => part && !ignored.has(normalized(part)) && !/^(?:数量|工程量|合同量|清单量|套数|倍数)$/.test(part))
  return candidate?.replace(/户型.*$/, '').replace(/^户型/, '').trim() ?? ''
}

function tryExpandMatrixRows(
  matrix: readonly unknown[][],
  headerIndex: number,
): { columns: string[], rows: BoqParsedSourceRow[] } | null {
  for (const depth of [3, 2]) {
    const headerRows = matrix.slice(headerIndex, headerIndex + depth).map(forwardFilled)
    if (headerRows.length !== depth)
      continue
    const width = Math.max(...headerRows.map(row => row.length), 0)
    const headerParts = Array.from(
      { length: width },
      (_, column) => headerRows.map(row => row[column] ?? '').filter(Boolean),
    )
    const qtyColumns = headerParts
      .map((parts, index) => ({ index, parts }))
      .filter(column => aliasesMatch(matrixHeaderLabel(column.parts), 'qty'))
    if (qtyColumns.length < 2)
      continue

    const columnIndex = (field: BoqImportField) =>
      headerParts.findIndex(parts => aliasesMatch(matrixHeaderLabel(parts), field))
    const itemNameIndex = columnIndex('itemName')
    const unitPriceIndex = columnIndex('unitPrice')
    if (itemNameIndex < 0 || unitPriceIndex < 0)
      continue
    const fixedFields = [
      'section',
      'trade',
      'itemCode',
      'itemName',
      'unit',
      'unitPrice',
      'totalQty',
      'building',
      'room',
      'floorZone',
      'spec',
      'taxRate',
      'ownerSupplied',
    ] as const
    const fixedIndexes = new Map(fixedFields.map(field => [field, columnIndex(field)]))
    const multiplierColumns = headerParts
      .map((parts, index) => ({ index, unitType: unitTypeFromHeader(parts) }))
      .filter(column => aliasesMatch(matrixHeaderLabel(headerParts[column.index] ?? []), 'multiplier'))
    const rows: BoqParsedSourceRow[] = []
    for (const [offset, cells] of matrix.slice(headerIndex + depth).entries()) {
      for (const quantityColumn of qtyColumns) {
        const quantity = cells[quantityColumn.index]
        if (String(quantity ?? '').trim() === '')
          continue
        const unitType = unitTypeFromHeader(quantityColumn.parts)
        const multiplierColumn = multiplierColumns.find(column => column.unitType === unitType)
        const values: Record<string, unknown> = {
          户型: unitType,
          工程量: quantity,
          套数: multiplierColumn ? cells[multiplierColumn.index] ?? '' : '',
        }
        for (const field of fixedFields) {
          const index = fixedIndexes.get(field) ?? -1
          if (index >= 0)
            values[FIELD_ALIASES[field][0]!] = cells[index] ?? ''
        }
        rows.push({
          sourceRow: headerIndex + depth + offset + 1,
          values,
        })
      }
    }
    if (!rows.length)
      continue
    return {
      columns: uniqueColumns(Object.keys(rows[0]?.values ?? {})),
      rows: rows.filter(row => Object.values(row.values).some(value => String(value ?? '').trim())),
    }
  }
  return null
}

function parseSheet(name: string, worksheet: XLSX.WorkSheet): BoqParsedSheet | null {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: '',
  })
  fillMergedCells(matrix, worksheet)
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
    return null
  const expanded = tryExpandMatrixRows(matrix, headerIndex)
  if (expanded) {
    return {
      name,
      headerRow: headerIndex + 1,
      columns: expanded.columns,
      rows: expanded.rows,
    }
  }
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
  const parsedSheets = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name]
    if (!worksheet)
      throw new Error(`工作表「${name}」读取失败`)
    return { name, sheet: parseSheet(name, worksheet) }
  })
  const sheets = parsedSheets.flatMap(result => result.sheet ? [result.sheet] : [])
  if (!sheets.length)
    throw new Error('所有工作表前 20 行都未识别到清单表头')
  const formatClass = detectFormat(fileName, workbook, sheets)
  return {
    fileName,
    formatClass,
    formatLabel: FORMAT_LABELS[formatClass],
    sheets,
    ignoredSheets: parsedSheets.flatMap(result => result.sheet ? [] : [result.name]),
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
  formatClass?: BoqFormatClass,
): BoqImportRow[] {
  if (!mapping.itemName || (!mapping.qty && formatClass !== 'E') || !mapping.unitPrice)
    throw new Error('分项名称、工程量、合同单价是导入必填映射')
  const rows: BoqImportRow[] = []
  let currentSection = ''
  let currentFloor = ''
  let currentSpec = ''
  for (const source of sheet.rows) {
    const itemName = text(source, mapping.itemName)
    const quantityText = text(source, mapping.qty)
    const unitPriceText = text(source, mapping.unitPrice)
    const detectedRowType = text(source, mapping.rowType)
      || Object.values(source.values).find(value => /^(?:A1章|BQDESC|BQITEM|TOTAL)$/i.test(String(value).trim()))
    if (formatClass === 'C' && detectedRowType) {
      if (/^A1章$/i.test(String(detectedRowType))) {
        currentSection = itemName || currentSection
        continue
      }
      if (/^BQDESC$/i.test(String(detectedRowType))) {
        currentSpec = itemName || currentSpec
        continue
      }
      if (!/^BQITEM$/i.test(String(detectedRowType)))
        continue
    }
    if (formatClass === 'D' && !quantityText && !unitPriceText && itemName) {
      if (/^(?:负?\d+层|首层|夹层|屋面层|地下.+层)$/.test(itemName))
        currentFloor = itemName
      else
        currentSection = itemName
      continue
    }
    if (!itemName || /^(?:合计|小计|总计|备注)$/.test(itemName))
      continue
    const qty = formatClass === 'E' && !quantityText
      ? 1
      : requiredNumber(quantityText, '工程量', source.sourceRow)
    const unitPrice = requiredNumber(unitPriceText, '合同单价', source.sourceRow)
    if (qty < 0 || unitPrice < 0)
      throw new Error(`第 ${source.sourceRow} 行工程量与合同单价不能为负数`)
    const amount = numberOrNull(text(source, mapping.amount)) ?? qty * unitPrice
    const ownerSupplied = /^(?:是|甲供|甲供材|1|true|yes)$/i.test(text(source, mapping.ownerSupplied))
    const rawSpec = text(source, mapping.spec) || currentSpec
    const inferredRoom = formatClass === 'B'
      ? /于([^，。；\s]+)/.exec(`${itemName} ${rawSpec}`)?.[1] ?? ''
      : ''
    rows.push({
      section: text(source, mapping.section) || currentSection,
      trade: text(source, mapping.trade),
      itemCode: text(source, mapping.itemCode),
      itemName,
      unit: text(source, mapping.unit),
      qty,
      totalQty: numberOrNull(text(source, mapping.totalQty)),
      unitPrice,
      amount: Math.round((amount + Number.EPSILON) * 100) / 100,
      building: text(source, mapping.building),
      unitType: text(source, mapping.unitType),
      multiplier: numberOrNull(text(source, mapping.multiplier)),
      room: text(source, mapping.room) || inferredRoom,
      floorZone: text(source, mapping.floorZone) || currentFloor,
      spec: rawSpec,
      taxRate: numberOrNull(text(source, mapping.taxRate)),
      ownerSupplied,
      sourceSheet: sheet.name,
      sourceRow: source.sourceRow,
    })
  }
  return rows
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

  if (input.formatClass === 'E') {
    for (const [index, row] of input.rows.entries()) {
      const priceId = generateId('item_unit_price')
      const itemId = (
        itemByCode.get(row.itemCode.trim().toLowerCase())
        ?? itemByName.get(row.itemName.trim())
        ?? null
      )
      const traceKey = `${input.fileName}·${row.sourceSheet}·${row.sourceRow}`
      await db.execute(
        `INSERT INTO item_unit_prices
          (id, project_id, item_id, boq_file_id, item_code, item_name, unit,
           unit_price, spec, trace_key, source_sheet, source_row, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          priceId,
          input.projectId,
          itemId,
          fileId,
          row.itemCode,
          row.itemName,
          row.unit,
          row.unitPrice,
          row.spec,
          traceKey,
          row.sourceSheet,
          row.sourceRow,
          (index + 1) * 10,
        ],
      )
      const priceLogId = await logCreate(db, 'item_unit_prices', priceId)
      if (priceLogId)
        logIds.push(priceLogId)
    }
    return {
      fileId,
      lineCount: 0,
      unitPriceCount: input.rows.length,
      linkedTemplateLineCount: 0,
      logIds,
    }
  }

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
      const templateLines = await db.select<{
        id: string
        room_code: string
        room_name: string
        room_kind: 'room' | 'whole_unit'
      }>(`
        SELECT hti.id,
               room_row.code AS room_code,
               room_row.name AS room_name,
               room_row.kind AS room_kind
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
      const requestedRoom = row.room.trim()
      const matchedTemplateLines = requestedRoom
        ? templateLines.filter(templateLine => (
            templateLine.room_code === requestedRoom
            || templateLine.room_name === requestedRoom
            || (
              templateLine.room_kind === 'whole_unit'
              && ['整户', '整户范围', '全屋'].includes(requestedRoom)
            )
          ))
        : templateLines
      // BOQ 是合同量唯一来源；只有“户型 + 标准分项 + 房间（若提供）”唯一命中才回接。
      // 模糊或多房间命中一律保留 BOQ 行，交给工程量页人工兜底，禁止最后一行静默覆盖。
      if (matchedTemplateLines.length === 1) {
        const templateLine = matchedTemplateLines[0]!
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
    unitPriceCount: 0,
    linkedTemplateLineCount,
    logIds,
  }
}
