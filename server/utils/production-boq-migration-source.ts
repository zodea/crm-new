import type { TransactionDb } from '../../app/lib/db/coordinator'
import { Buffer } from 'node:buffer'
import { captureMigrationDomainRows } from './migration-domain-evidence'
import { productionBoqFailure as boqFail } from './production-boq-codec'

export type BoqNativeRow = Record<string, unknown>
export const BOQ_NATIVE_TABLES = ['boq_files', 'boq_lines', 'item_unit_prices', 'boq_change_orders', 'boq_change_lines', 'owner_change_orders', 'file_refs', 'file_payloads', 'operation_logs'] as const

/** Original SQLite is query-only. Capture this owner's complete physical graph, including deleted records. */
export async function readBoqNativeSource(db: TransactionDb, proof: { sha256: string, schemaVersion: number }) {
  if (proof.schemaVersion < 47 || proof.schemaVersion > 60)
    return boqFail('validation-failed', '此完整 SQLite 上游版本尚未核验；保留原库，不作升级或全量初始化')
  const contracts = await db.select<BoqNativeRow>('SELECT id,project_id,kind FROM contracts WHERE kind=\'施工\' ORDER BY id')
  const owns = (row: BoqNativeRow) => contracts.some(head => head.id === row.contract_id)
  const files = (await db.select<BoqNativeRow>('SELECT * FROM boq_files ORDER BY id')).filter(owns)
  const lines = (await db.select<BoqNativeRow>('SELECT * FROM boq_lines ORDER BY id')).filter(owns)
  const changes = (await db.select<BoqNativeRow>('SELECT * FROM boq_change_orders ORDER BY id')).filter(owns)
  const changeLines = (await db.select<BoqNativeRow>('SELECT * FROM boq_change_lines ORDER BY sort_order,id')).filter(row => changes.some(change => change.id === row.change_order_id))
  const ledgers = (await db.select<BoqNativeRow>('SELECT * FROM owner_change_orders ORDER BY id')).filter(row => owns(row) || changes.some(change => change.ledger_id === row.id))
  const prices = (await db.select<BoqNativeRow>('SELECT * FROM item_unit_prices ORDER BY id')).filter(row => files.some(file => file.id === row.boq_file_id))
  if (!files.length && !lines.length && !changes.length && !ledgers.length && !prices.length)
    return boqFail('validation-failed', '此完整来源没有本域施工清单、独立E价或变洽签原图，无需采用空领域')
  for (const line of lines) {
    if (contracts.find(head => head.id === line.contract_id)?.project_id !== line.project_id)
      return boqFail('relationship-mismatch', '原清单行项目与原施工主合同真实项目不同，不能迁入后修成一致')
    if (line.boq_file_id ? !files.some(file => file.id === line.boq_file_id && file.contract_id === line.contract_id) : !changes.some(change => change.id === line.change_order_id && change.contract_id === line.contract_id))
      return boqFail('relationship-mismatch', '原清单行的文件或变洽签父关系无法互证，整批保留不采用')
  }
  for (const change of changes) {
    if (change.status === 'approved' && (!change.ledger_id || !ledgers.some(ledger => ledger.id === change.ledger_id && ledger.source_id === change.id && ledger.source_type === 'boq_change_order' && ledger.source_locked === 1)))
      return boqFail('relationship-mismatch', '已签证变化缺真实原锁定管理簿，不能补造签证历史')
  }
  for (const row of changeLines) {
    const target = row.result_boq_line_id ?? row.boq_line_id
    const parent = changes.find(change => change.id === row.change_order_id)!
    if (target && !lines.some(line => line.id === target && line.contract_id === parent.contract_id && line.project_id === parent.project_id))
      return boqFail('relationship-mismatch', '原变化细格与原清单项目/主合同不同')
  }
  const attachments = (await db.select<BoqNativeRow>('SELECT * FROM file_refs WHERE owner_type IN(\'boq_file\',\'boq_change_order\',\'owner_change_order\') ORDER BY id')).filter(row => (row.owner_type === 'boq_file' ? files : row.owner_type === 'boq_change_order' ? changes : ledgers).some(owner => owner.id === row.owner_id))
  const payloads = (await db.select<BoqNativeRow>('SELECT * FROM file_payloads ORDER BY file_ref_id')).filter(row => attachments.some(file => file.id === row.file_ref_id))
  for (const body of payloads) {
    if (body.encoding !== 'base64' || typeof body.content !== 'string' || Buffer.from(body.content, 'base64').toString('base64') !== body.content)
      return boqFail('validation-failed', '原施工清单/证据文件正文编码不完整，不可静默省略')
  }
  const groups: Record<string, BoqNativeRow[]> = { boq_files: files, boq_lines: lines, item_unit_prices: prices, boq_change_orders: changes, boq_change_lines: changeLines, owner_change_orders: ledgers, file_refs: attachments, file_payloads: payloads }
  const logs = (await db.select<BoqNativeRow>('SELECT * FROM operation_logs ORDER BY id')).filter(row => groups[String(row.table_name)]?.some(record => (row.table_name === 'file_payloads' ? record.file_ref_id : record.id) === row.record_id))
  groups.operation_logs = logs
  const raw = await captureMigrationDomainRows(db, BOQ_NATIVE_TABLES.map(table => ({ table, key: table === 'file_payloads' ? 'file_ref_id' : 'id', ids: groups[table]!.map(row => String(table === 'file_payloads' ? row.file_ref_id : row.id)) })))
  return { sourceSha256: proof.sha256, schemaVersion: proof.schemaVersion, files, lines, prices, changes, changeLines, ledgers, attachments, payloads, logs, raw }
}
export type BoqNativeSource = Awaited<ReturnType<typeof readBoqNativeSource>>
