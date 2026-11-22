import type { TransactionDb } from '../../app/lib/db/coordinator'

/** Only known physical source identities, including immutable relations and original source commands. */
export async function productionSubcontractContractConsumed(tx: Pick<TransactionDb, 'select'>, id: string) {
  for (const table of ['construction_scope_links', 'construction_scope_history']) {
    if ((await tx.select(`SELECT 1 FROM ${table} WHERE source_domain='subcontract-contract' AND source_id=? LIMIT 1`, [id]))[0])
      return true
  }
  for (const table of ['subcontract_changes', 'subcontract_settlements', 'subcontract_final_settlements', 'invoice_records', 'payment_records', 'payment_applications', 'project_penalties', 'subcontract_change_orders', 'expenditure_settlements', 'penalty_records', 'owner_document_import_bindings']) {
    const columns = await tx.select<{ name: string }>(`PRAGMA table_info(${table})`)
    if (columns.some(column => column.name === 'contract_id') && (await tx.select(`SELECT 1 FROM ${table} WHERE contract_id=? LIMIT 1`, [id]))[0])
      return true
  }
  if ((await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'owner_document_command_intents\''))[0]) {
    for (const row of await tx.select<{ request_json: string }>('SELECT request_json FROM owner_document_command_intents')) {
      const request = JSON.parse(row.request_json)
      if (['sub_change', 'sub_settlement', 'project_penalty'].includes(request.kind) && request.draft?.contractId === id)
        return true
    }
    for (const row of await tx.select<{ kind: string, before_json: string | null, after_json: string }>('SELECT kind,before_json,after_json FROM owner_document_history')) {
      if (['sub_change', 'sub_settlement', 'project_penalty'].includes(row.kind)
        && [row.before_json, row.after_json].some(value => value !== null && JSON.parse(value).contractId === id)) {
        return true
      }
    }
  }
  for (const row of await tx.select<{ request_json: string }>('SELECT request_json FROM construction_scope_intents')) {
    const request = JSON.parse(row.request_json)
    if (request.source?.domain === 'subcontract-contract' && request.source.id === id)
      return true
  }
  const financeTables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'finance_commands\'')
  if (financeTables.length) {
    for (const row of await tx.select<{ request_json: string }>('SELECT request_json FROM finance_commands')) {
      const request = JSON.parse(row.request_json)
      if (request.draft?.contractId === id)
        return true
    }
  }
  return false
}
