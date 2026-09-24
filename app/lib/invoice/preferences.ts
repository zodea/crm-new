import type { InvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import {
  createDefaultInvoiceXlsxStyleConfig,
  normalizeInvoiceXlsxStyleConfig,
} from '~/lib/invoice/excel'

export interface InvoiceExportSettingsDatabase {
  execute: (sql: string, params?: unknown[]) => Promise<void>
  select: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}

export async function loadInvoiceExportStyleSetting(
  database: InvoiceExportSettingsDatabase,
): Promise<InvoiceXlsxStyleConfig> {
  const [row] = await database.select<{ settings_json: string }>(
    `SELECT settings_json FROM invoice_export_settings WHERE id = 'default'`,
  )
  if (!row)
    return createDefaultInvoiceXlsxStyleConfig()
  try {
    return normalizeInvoiceXlsxStyleConfig(JSON.parse(row.settings_json) as unknown)
  }
  catch {
    return createDefaultInvoiceXlsxStyleConfig()
  }
}

export async function saveInvoiceExportStyleSetting(
  database: InvoiceExportSettingsDatabase,
  style: InvoiceXlsxStyleConfig,
): Promise<InvoiceXlsxStyleConfig> {
  const normalized = normalizeInvoiceXlsxStyleConfig(style)
  await database.execute(
    `INSERT INTO invoice_export_settings (id, settings_json, updated_at)
     VALUES ('default', ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       settings_json = excluded.settings_json,
       updated_at = excluded.updated_at`,
    [JSON.stringify(normalized)],
  )
  return normalized
}
