import type { TransactionDb } from '../db/coordinator'
import { hasProductionPayrollSchema } from './central-schema'

export const PAYROLL_NUMBERING_COLUMNS = {
  payroll_numbering_settings: ['id', 'project_id', 'first_number', 'next_number', 'evidence_note', 'initialized_at', 'operator_id'],
  payroll_official_issues: ['id', 'project_id', 'statement_id', 'format_family', 'official_number', 'document_hash', 'issued_at', 'operator_id', 'command_id'],
} as const
export type PayrollNumberingTable = keyof typeof PAYROLL_NUMBERING_COLUMNS
export const PAYROLL_NUMBERING_TABLES = Object.keys(PAYROLL_NUMBERING_COLUMNS) as PayrollNumberingTable[]

/** 只保存原工资的正式出具身份；不另存或重算工资金额。 */
export async function initializePayrollNumberingSchema(db: TransactionDb) {
  if (await hasProductionPayrollSchema(db))
    return
  await db.execute(`CREATE TABLE IF NOT EXISTS payroll_numbering_settings (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    first_number INTEGER NOT NULL CHECK(first_number>0), next_number INTEGER NOT NULL CHECK(next_number>=first_number),
    evidence_note TEXT NOT NULL, initialized_at TEXT NOT NULL, operator_id TEXT NOT NULL)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS payroll_official_issues (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    statement_id TEXT NOT NULL UNIQUE REFERENCES wage_statements(id), format_family TEXT NOT NULL,
    official_number TEXT NOT NULL, document_hash TEXT NOT NULL,
    issued_at TEXT NOT NULL, operator_id TEXT NOT NULL, command_id TEXT NOT NULL,
    UNIQUE(project_id,official_number))`)
}
