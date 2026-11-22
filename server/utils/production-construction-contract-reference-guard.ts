import type { TransactionDb } from '../../app/lib/db/coordinator'

/** Known typed identities, including immutable history and original intents; never infer parentage from arbitrary JSON. */
export async function productionConstructionContractConsumed(tx: Pick<TransactionDb, 'select'>, id: string) {
  for (const [table, key] of [
    ['boq_files', 'contract_id'],
    ['boq_lines', 'contract_id'],
    ['item_unit_prices', 'contract_id'],
    ['boq_change_records', 'contract_id'],
    ['boq_history', 'contract_id'],
    ['boq_command_intents', 'contract_id'],
    ['boq_commands', 'contract_id'],
    ['boq_source_bindings', 'contract_id'],
    ['quantity_contract_references', 'id'],
    ['quantity_boq_references', 'contract_id'],
    ['schedule_groups', 'contract_id'],
    ['construction_scope_links', 'main_id'],
    ['construction_scope_history', 'main_id'],
    ['receipt_registrations', 'contract_id'],
    ['payment_records', 'contract_id'],
    ['monthly_statements', 'contract_id'],
    ['project_acceptances', 'contract_id'],
    ['owner_final_settlements', 'contract_id'],
    ['owner_penalties', 'contract_id'],
    ['owner_document_import_bindings', 'contract_id'],
  ]) {
    const columns = await tx.select<{ name: string }>(`PRAGMA table_info(${table})`)
    if (columns.some(column => column.name === key) && (await tx.select(`SELECT 1 FROM ${table} WHERE ${key}=? LIMIT 1`, [id]))[0])
      return true
  }
  const commercial = await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'owner_document_command_intents\'')
  if (commercial.length) {
    for (const row of await tx.select<{ request_json: string }>('SELECT request_json FROM owner_document_command_intents')) {
      const request = JSON.parse(row.request_json)
      if (['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty'].includes(request.kind) && request.draft?.contractId === id)
        return true
    }
    for (const row of await tx.select<{ kind: string, before_json: string | null, after_json: string }>('SELECT kind,before_json,after_json FROM owner_document_history')) {
      if (['owner_change', 'owner_report', 'acceptance', 'final_settlement', 'owner_penalty'].includes(row.kind)
        && [row.before_json, row.after_json].some(value => value !== null && JSON.parse(value).contractId === id)) {
        return true
      }
    }
  }
  for (const [table, family] of [['schedule_command_intents', 'schedule'], ['boq_import_intents', 'boq-import'], ['construction_scope_intents', 'scope']]) {
    if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [table]))[0])
      continue
    for (const row of await tx.select<{ request_json: string }>(`SELECT request_json FROM ${table}`)) {
      const value = JSON.parse(row.request_json)
      if (family === 'schedule' && (value.action?.kind === 'bind-contract' ? value.action.contractId : value.action?.kind === 'create-group' && value.action.draft?.scopeBasis !== 'provisional' ? value.action.draft?.contractId : null) === id)
        return true
      if (family === 'boq-import' && value.action === 'adopt' && Array.isArray(value.heads) && value.heads.some((head: { id: string }) => head.id === id))
        return true
      if (family === 'scope' && value.action === 'bind' && value.mainId === id)
        return true
    }
  }
  return false
}
