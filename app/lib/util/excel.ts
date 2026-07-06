import * as XLSX from 'xlsx'

// 纯 Excel 读写工具（无响应式/无生命周期，故为普通函数而非 composable）。
// 原 app/composables/useExcelIO.ts，按 vue-best-practices「纯工具不做 composable」迁此。

export interface ColumnDef<T = Record<string, unknown>> {
  header: string
  key: keyof T
  width?: number
  format?: (val: unknown) => unknown
}

export interface ImportOptions {
  headerAliases?: Record<string, string[]>
  dedupeKey?: string | string[]
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
      if (!ws['!cols']) ws['!cols'] = []
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

export function importFromXlsx<T extends Record<string, unknown>>(
  file: File | ArrayBuffer,
  columns: ColumnDef<T>[],
  options: ImportOptions = {},
): Promise<Partial<T>[]> {
  return new Promise((resolve, reject) => {
    const process = (buffer: ArrayBuffer) => {
      try {
        const wb = XLSX.read(buffer, { type: 'array' })
        const firstSheetName = wb.SheetNames[0]
        const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined
        if (!ws) throw new Error('Excel 文件中没有工作表')
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)

        const headerMap = new Map<string, keyof T>()
        for (const col of columns) {
          headerMap.set(col.header, col.key)
          const aliases = options.headerAliases?.[col.header as string]
          if (aliases) {
            for (const alias of aliases) {
              headerMap.set(alias, col.key)
            }
          }
        }

        const results: Partial<T>[] = raw.map((row) => {
          const mapped: Partial<T> = {}
          for (const [rawKey, val] of Object.entries(row)) {
            const key = headerMap.get(rawKey.trim())
            if (key) {
              (mapped as any)[key] = val
            }
          }
          return mapped
        })

        if (options.dedupeKey) {
          const keys = Array.isArray(options.dedupeKey) ? options.dedupeKey : [options.dedupeKey]
          const seen = new Set<string>()
          const deduped: Partial<T>[] = []
          for (const item of results) {
            const k = keys.map(k => String((item as any)[k] ?? '')).join('|')
            if (!seen.has(k)) {
              seen.add(k)
              deduped.push(item)
            }
          }
          resolve(deduped)
        }
        else {
          resolve(results)
        }
      }
      catch (e) {
        reject(e)
      }
    }

    if (file instanceof File) {
      const reader = new FileReader()
      reader.onload = e => process(e.target!.result as ArrayBuffer)
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    }
    else {
      process(file)
    }
  })
}
