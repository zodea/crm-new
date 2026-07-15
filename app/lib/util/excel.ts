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
  columns: string[]
  rows: Record<string, unknown>[]
}

function bufferFromFile(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target!.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsArrayBuffer(file)
  })
}

function sheetToRawImport(wb: XLSX.WorkBook): RawImportSheet {
  const firstSheetName = wb.SheetNames[0]
  const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined
  if (!ws)
    throw new Error('文件中没有工作表')

  // columns 必须与 sheet_to_json 的行键逐字一致（不 trim、重复表头按 SheetJS
  // 规则加 _1/_2 后缀），否则映射存下的列名在数据行里永远取不到值。
  const headerRow = XLSX.utils
    .sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []
  const nameCounts = new Map<string, number>()
  const columns: string[] = []
  for (const cell of headerRow) {
    const raw = cell == null ? '' : String(cell)
    // 空表头列即 SheetJS 的 __EMPTY 键，无法可靠映射，跳过不进下拉。
    if (!raw.trim())
      continue
    const count = nameCounts.get(raw) ?? 0
    nameCounts.set(raw, count + 1)
    columns.push(count === 0 ? raw : `${raw}_${count}`)
  }
  if (!columns.length)
    throw new Error('未能从文件第一行读取到表头')

  // raw:false = 所见即所得：日期/数字按单元格显示格式转文本，
  // 避免日期以 Excel 序列号进入预览与导入行。
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false })
  return { columns, rows }
}

function hasMojibake(sheet: RawImportSheet): boolean {
  return sheet.columns.some(column => column.includes('�'))
}

/**
 * 为导入映射解析 Excel/CSV：返回原始表头与按表头键入的数据行，
 * 不做任何字段映射（映射在 KitUI 导入页签里由用户完成，见 ADR 0005）。
 */
export async function parseSheetForMapping(file: File | ArrayBuffer): Promise<RawImportSheet> {
  const buffer = file instanceof File ? await bufferFromFile(file) : file
  // codepage 65001 = UTF-8：无 BOM 的 CSV 默认按 UTF-8 解码，避免中文表头乱码。
  const sheet = sheetToRawImport(XLSX.read(buffer, { type: 'array', codepage: 65001 }))
  if (!hasMojibake(sheet))
    return sheet

  // 表头出现替换符 → 大概率是中文 Excel「另存为 CSV」的 GBK 编码，按 GB18030 重读。
  const text = new TextDecoder('gb18030').decode(buffer)
  const fallback = sheetToRawImport(XLSX.read(text, { type: 'string' }))
  return hasMojibake(fallback) ? sheet : fallback
}

// 原 importFromXlsx（headerAliases 自动映射）已被 ADR 0005 的用户交互映射
// （autoMatchColumns + buildImportRows）取代，零调用后移除，避免双解析管线漂移。
