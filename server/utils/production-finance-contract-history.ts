import type { TransactionDb } from '../../app/lib/db/coordinator'
import { createHash } from 'node:crypto'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { PRODUCTION_STORAGE_VERSION } from './production-storage-schema'

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = () => financeFailure('unavailable', '付款合同升级边界或冻结历史证据损坏。')
const key = (kind: unknown, id: unknown, version: unknown) => JSON.stringify([kind, id, version])

/** v31 captures exact pre-upgrade bytes before locking the evidence tables; older backups have no such tables. */
export async function validateFinanceContractHistory(db: Pick<TransactionDb, 'select'>, suppliedHistory?: Row[]) {
  const [metadata] = await db.select<{ schema_version: number }>('SELECT schema_version FROM production_metadata WHERE singleton=1')
  const [participant] = await db.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', ['finance'])
  if (!metadata || !Number.isSafeInteger(metadata.schema_version) || metadata.schema_version < 10 || metadata.schema_version > PRODUCTION_STORAGE_VERSION
    || !participant || participant.schema_version !== (metadata.schema_version >= 31 ? 2 : 1)) {
    return invalid()
  }
  const tables = await db.select<{ name: string }>('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name IN (\'finance_contract_upgrade_anchor\',\'finance_contract_legacy_history\')')
  if (tables.length !== (metadata.schema_version >= 31 ? 2 : 0))
    return invalid()
  const history = suppliedHistory ?? await db.select<Row>('SELECT * FROM finance_history ORDER BY kind,id,version')
  const legacy = new Set<string>()
  if (metadata.schema_version >= 31) {
    const anchors = await db.select<Row>('SELECT * FROM finance_contract_upgrade_anchor')
    const proofs = await db.select<Row>('SELECT * FROM finance_contract_legacy_history')
    if (anchors.length !== 1 || anchors[0]!.singleton !== 1 || !Number.isSafeInteger(anchors[0]!.legacy_history_count) || anchors[0]!.legacy_history_count !== proofs.length)
      return invalid()
    for (const proof of proofs) {
      if (!['payment_application', 'payment_record'].includes(String(proof.kind)) || typeof proof.id !== 'string' || !Number.isSafeInteger(proof.version) || Number(proof.version) < 1 || typeof proof.snapshot_json !== 'string')
        return invalid()
      const original = history.find(row => row.kind === proof.kind && row.id === proof.id && row.version === proof.version)
      const scope = key(proof.kind, proof.id, proof.version)
      const bytes = original?.snapshot_json
      if (!original || legacy.has(scope) || original.command_id !== proof.command_id || original.actor_id !== proof.actor_id || original.occurred_at !== proof.occurred_at
        || typeof bytes !== 'string' || createHash('sha256').update(bytes).digest('hex') !== createHash('sha256').update(proof.snapshot_json).digest('hex') || bytes !== proof.snapshot_json) {
        return invalid()
      }
      let snapshot: unknown
      try {
        snapshot = JSON.parse(proof.snapshot_json)
      }
      catch { return invalid() }
      if (!object(snapshot) || !object(snapshot.head) || snapshot.head.id !== proof.id || (proof.kind === 'payment_application' && (Object.hasOwn(snapshot.head, 'contract_domain') || Object.hasOwn(snapshot.head, 'contract_version'))))
        return invalid()
      legacy.add(scope)
    }
    for (const row of history.filter(item => item.kind === 'payment_application')) {
      let snapshot: unknown
      try {
        snapshot = JSON.parse(String(row.snapshot_json))
      }
      catch { return invalid() }
      if (!object(snapshot) || !object(snapshot.head))
        return invalid()
      const hasDomain = Object.hasOwn(snapshot.head, 'contract_domain')
      const hasVersion = Object.hasOwn(snapshot.head, 'contract_version')
      if (hasDomain !== hasVersion || (!hasDomain && !legacy.has(key(row.kind, row.id, row.version))))
        return invalid()
    }
  }
  return { schemaVersion: metadata.schema_version, isLegacy: (id: unknown, version: unknown) => legacy.has(key('payment_application', id, version)), isLegacyFinance: (kind: unknown, id: unknown, version: unknown) => legacy.has(key(kind, id, version)) }
}
