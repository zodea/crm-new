import type { TransactionDb } from '../db/coordinator'
import { normalizeSqlDefinition } from '../db/schema-evidence'
import { MATERIAL_QUOTATION_SCHEMA } from './schema'
import { validateQuotationJournal } from './sqlite-owner'
/** Each generated DDL occupies one line; trigger bodies retain their internal semicolons. */
export const quotationSchemaStatements = () => MATERIAL_QUOTATION_SCHEMA.trim().split(/;\r?\n/).map(sql => sql.replace(/;$/, '').trim()).filter(Boolean)
const normalized = normalizeSqlDefinition
export function materialQuotationSchemaDefinitions() {
  return quotationSchemaStatements().filter(sql => sql.startsWith('CREATE')).map((sql) => {
    const match = /^CREATE (TABLE|INDEX|TRIGGER) (\w+)/.exec(sql)!
    return { type: match[1]!.toLowerCase(), name: match[2]!, sql }
  })
}
export async function validateMaterialQuotationSchema(db: TransactionDb) {
  const definitions = materialQuotationSchemaDefinitions()
  const names = definitions.map(definition => definition.name)
  const existing = await db.select<{
    type: string
    name: string
    sql: string
  }>(`SELECT type,name,sql FROM sqlite_schema WHERE name IN (${names.map(() => '?').join(',')})`, names)
  if (existing.length !== definitions.length || definitions.some(definition => !existing.some(row => row.name === definition.name && row.type === definition.type && normalized(row.sql) === normalized(definition.sql)))) {
    throw new Error('独立报价结构部分缺失或与已确认结构冲突；保留原库，不覆盖现有事实')
  }
}
/** A committed schema may precede version bookkeeping after interruption. Verify it without overwriting facts. */
export async function ensureMaterialQuotationSchema(db: TransactionDb) {
  const names = materialQuotationSchemaDefinitions().map(definition => definition.name)
  const existing = await db.select<{
    name: string
  }>(`SELECT name FROM sqlite_schema WHERE name IN (${names.map(() => '?').join(',')})`, names)
  if (!existing.length) {
    for (const sql of quotationSchemaStatements())
      await db.execute(sql)
  }
  await validateMaterialQuotationSchema(db)
  await validateQuotationJournal(db)
}
