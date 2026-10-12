import * as XLSX from 'xlsx'

// 纯 Excel 读写工具（无响应式/无生命周期，故为普通函数而非 composable）。
// 原 app/composables/useExcelIO.ts，按 vue-best-practices「纯工具不做 composable」迁此。

export interface ColumnDef<T = Record<string, unknown>> {
  header: string
  key: keyof T
  width?: number
  format?: (val: unknown) => unknown
}

export function exportToXlsx<T extends Record<string, unknown>>(
  data: T[],
  columns: ColumnDef<T>[],
  sheetName = 'Sheet1',
  fileName = 'export.xlsx',
) {
  const headers = columns.map(c => c.header)
  const rows = data.map(row =>
    columns.map((c) => {
      const val = row[c.key]
      return c.format ? c.format(val) : val
    }),
  )

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  columns.forEach((c, i) => {
    if (c.width) {
      if (!ws['!cols'])
        ws['!cols'] = []
      ws['!cols'][i] = { wch: c.width }
    }
  })

  const firstRow = data[0]
  if (firstRow) {
    const numericCols = columns
      .map((c, i) => ({ col: i, key: c.key }))
      .filter(({ key }) => typeof firstRow[key] === 'number')

    for (const { col } of numericCols) {
      const colLetter = XLSX.utils.encode_col(col)
      const startRow = 2
      const endRow = data.length + 1
      const sumCell = XLSX.utils.encode_cell({ r: endRow, c: col })
      ws[sumCell] = {
        t: 'n',
        f: `SUM(${colLetter}${startRow}:${colLetter}${endRow})`,
      }
    }

    const sumRowLabel = XLSX.utils.encode_cell({ r: data.length + 1, c: 0 })
    if (!ws[sumRowLabel]) {
      ws[sumRowLabel] = { t: 's', v: '合计' }
    }

    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: data.length + 1, c: columns.length - 1 },
    })
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName)
}

export interface RawImportSheet {
  sourceFileName?: string
  sourceHash?: string
  /** 与 rows 对齐的 Excel 原始 1 起始行号，保留被跳过的空行位置。 */
  rowNumbers?: number[]
  name: string
  headerRow: number
  range: string
  mergeRanges: string[]
  formulaCount: number
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface RawImportWorkbook {
  sheets: RawImportSheet[]
}

function bufferFromFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target!.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsArrayBuffer(file)
  })
}

const IMPORT_HEADER_HINTS = [
  '发票日期',
  '开票日期',
  '发票号码',
  '公司名称',
  '开票单位',
  '金额',
  '价税合计',
  '使用工地',
] as const

function matrixFromSheet(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, range: 0 })
}

function expandMergedValues(ws: XLSX.WorkSheet, source: unknown[][]): unknown[][] {
  const matrix = source.map(row => [...row])
  for (const merge of ws['!merges'] ?? []) {
    const value = matrix[merge.s.r]?.[merge.s.c]
    if (value == null || value === '')
      continue
    for (let row = merge.s.r; row <= merge.e.r; row++) {
      for (let column = merge.s.c; column <= merge.e.c; column++) {
        if (matrix[row]?.[column] == null || matrix[row]?.[column] === '')
          matrix[row]![column] = value
      }
    }
  }
  return matrix
}

function headerRowScore(row: unknown[]): number {
  const values = row.map(value => String(value ?? ''))
  const hints = IMPORT_HEADER_HINTS.filter(hint => values.some(value => value.includes(hint)))
  const nonEmpty = values.filter(value => value.trim()).length
  return hints.length * 100 + nonEmpty
}

function detectHeaderRow(matrix: unknown[][]): number {
  const candidates = matrix.slice(0, Math.min(matrix.length, 30))
  let selected = 0
  let bestScore = -1
  for (const [index, row] of candidates.entries()) {
    const score = headerRowScore(row)
    if (score > bestScore) {
      bestScore = score
      selected = index
    }
  }
  return selected
}

function sheetToRawImport(
  wb: XLSX.WorkBook,
  sheetName = wb.SheetNames[0],
  requestedHeaderRow?: number,
): RawImportSheet {
  const ws = sheetName ? wb.Sheets[sheetName] : undefined
  if (!ws)
    throw new Error('文件中没有工作表')

  const matrix = expandMergedValues(ws, matrixFromSheet(ws))
  const headerRow = requestedHeaderRow ?? detectHeaderRow(matrix)

  // columns 必须与 sheet_to_json 的行键逐字一致（不 trim、重复表头按 SheetJS
  // 规则加 _1/_2 后缀），否则映射存下的列名在数据行里永远取不到值。
  const headerValues = matrix[headerRow] ?? []
  const nameCounts = new Map<string, number>()
  const columnEntries: { name: string, index: number }[] = []
  for (const [index, cell] of headerValues.entries()) {
    const raw = cell == null ? '' : String(cell)
    // 空表头列即 SheetJS 的 __EMPTY 键，无法可靠映射，跳过不进下拉。
    if (!raw.trim())
      continue
    const count = nameCounts.get(raw) ?? 0
    nameCounts.set(raw, count + 1)
    columnEntries.push({ name: count === 0 ? raw : `${raw}_${count}`, index })
  }
  const columns = columnEntries.map(entry => entry.name)
  if (!columns.length && matrix.some(row => row.some(value => String(value ?? '').trim())))
    throw new Error('未能从文件读取到表头')

  // raw:false = 所见即所得：日期/数字按单元格显示格式转文本，
  // 避免日期以 Excel 序列号进入预览与导入行；合并区续行已展开。
  const entries = matrix
    .slice(headerRow + 1)
    .map((row, index) => ({ row, rowNumber: headerRow + index + 2 }))
    .filter(({ row }) => row.some(value => value != null && String(value).trim() !== ''))
  const rows = entries.map(({ row }) => {
    const result: Record<string, unknown> = {}
    for (const entry of columnEntries) {
      const value = row[entry.index]
      if (value != null && value !== '')
        result[entry.name] = value
    }
    return result
  })

  const mergeRanges = (ws['!merges'] ?? []).map(merge => XLSX.utils.encode_range(merge))
  const formulaCount = Object.keys(ws)
    .filter(address => !address.startsWith('!'))
    .filter(address => Boolean(ws[address]?.f))
    .length

  return {
    name: sheetName ?? 'Sheet1',
    headerRow,
    range: ws['!ref'] ?? '',
    mergeRanges,
    formulaCount,
    columns,
    rows,
    rowNumbers: entries.map(entry => entry.rowNumber),
  }
}

function hasMojibake(sheet: RawImportSheet): boolean {
  return sheet.columns.some(column => column.includes('�'))
}

/**
 * 解析工作簿的全部 sheet，并为每个 sheet 自动识别表头行。
 * 多 sheet 票据导入由专用上传步骤选择目标 sheet；通用导入仍使用第一张 sheet。
 */
export async function parseWorkbookForMapping(file: File | ArrayBuffer): Promise<RawImportWorkbook> {
  const buffer = file instanceof File ? await bufferFromFile(file) : file
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  const sourceHash = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
  const withSource = (sheet: RawImportSheet) => ({ ...sheet, sourceFileName: file instanceof File ? file.name : '导入.xlsx', sourceHash })
  // CSV 保留字面值，避免日期被自动改成本地短格式；raw 读取选项不改变 XLSX 单元格格式。
  // codepage 65001 = UTF-8：无 BOM CSV 默认按 UTF-8 解码，避免中文表头乱码。
  const workbook = XLSX.read(buffer, { type: 'array', codepage: 65001, raw: true })
  const sheets = workbook.SheetNames.map(name => withSource(sheetToRawImport(workbook, name)))
  const parsed = { sheets }
  if (!sheets.some(sheet => hasMojibake(sheet)))
    return parsed

  // 表头出现替换符 → 大概率是中文 Excel「另存为 CSV」的 GBK 编码，按 GB18030 重读。
  const text = new TextDecoder('gb18030').decode(buffer)
  const fallbackWorkbook = XLSX.read(text, { type: 'string', raw: true })
  const fallback = {
    sheets: fallbackWorkbook.SheetNames.map(name => withSource(sheetToRawImport(fallbackWorkbook, name))),
  }
  return fallback.sheets.some(sheet => hasMojibake(sheet)) ? parsed : fallback
}

// 原 importFromXlsx（headerAliases 自动映射）已被 ADR 0005 的用户交互映射
// （autoMatchColumns + buildImportRows）取代，零调用后移除，避免双解析管线漂移。
