import { select } from './connection'

const SKIP_TABLES = new Set(['sqlite_sequence'])

export async function getAllTableNames(): Promise<string[]> {
  const rows = await select<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  )
  return rows.map(r => r.name).filter(n => !SKIP_TABLES.has(n))
}

export async function getTableRowCount(table: string): Promise<number> {
  const [row] = await select<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${table}"`)
  return row?.cnt ?? 0
}

export async function exportTableToJson(table: string): Promise<Record<string, unknown>[]> {
  return select<Record<string, unknown>>(`SELECT * FROM "${table}"`)
}

export interface SeedExportResult {
  table: string
  rows: number
  json: string
}

export async function exportAllSeeds(): Promise<SeedExportResult[]> {
  const tables = await getAllTableNames()
  const results: SeedExportResult[] = []

  for (const table of tables) {
    const count = await getTableRowCount(table)
    if (count === 0) continue

    const rows = await exportTableToJson(table)
    results.push({
      table,
      rows: count,
      json: JSON.stringify(rows, null, 2),
    })
  }

  return results
}
