import type { TransactionDb } from '../db/coordinator'
import type { ConstructionManagementFeeConfiguration } from './management-fee'
import { decodeConstructionManagementFee, emptyConstructionManagementFee } from './management-fee'

/** 在既有 Native v57 事务中调用；旧合同、原件、日志及回执均不重建。 */
export async function ensureConstructionManagementFeeSchema(db: TransactionDb): Promise<void> {
  const columns = await db.select<{ name: string }>('PRAGMA table_info(contracts)')
  if (!columns.some(row => row.name === 'id') || !columns.some(row => row.name === 'kind'))
    throw new Error('[db] v57 缺少既有合同表或身份列，停止升级')
  for (const [name, definition] of [
    ['management_fee_amount', 'REAL DEFAULT NULL CHECK(management_fee_amount IS NULL OR management_fee_amount >= 0)'],
    ['management_fee_basis', 'TEXT NOT NULL DEFAULT \'\''],
    ['management_fee_version', 'TEXT DEFAULT NULL'],
  ]) {
    if (!columns.some(row => row.name === name))
      await db.execute(`ALTER TABLE contracts ADD COLUMN ${name} ${definition}`)
  }
  await db.execute(`CREATE TABLE IF NOT EXISTS construction_management_fee_history (
    version TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id),
    amount REAL DEFAULT NULL CHECK(amount IS NULL OR amount >= 0),
    basis TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    adopted_at TEXT NOT NULL,
    actor_id TEXT,
    command_id TEXT
  )`)
  await db.execute('CREATE INDEX IF NOT EXISTS idx_construction_management_fee_history_contract ON construction_management_fee_history(contract_id, adopted_at, version)')
  await db.execute(`CREATE TRIGGER IF NOT EXISTS construction_management_fee_history_no_update
    BEFORE UPDATE ON construction_management_fee_history BEGIN SELECT RAISE(ABORT,'总合同管理费冻结历史不能修改'); END`)
  await db.execute(`CREATE TRIGGER IF NOT EXISTS construction_management_fee_history_no_delete
    BEFORE DELETE ON construction_management_fee_history BEGIN SELECT RAISE(ABORT,'总合同管理费冻结历史不能删除'); END`)
  await db.execute(`CREATE TRIGGER IF NOT EXISTS construction_management_fee_history_owner
    BEFORE INSERT ON construction_management_fee_history
    WHEN NOT EXISTS(SELECT 1 FROM contracts WHERE id=NEW.contract_id AND kind='施工')
    BEGIN SELECT RAISE(ABORT,'管理费配置仅适用于施工主合同'); END`)
  await db.execute(`CREATE TRIGGER IF NOT EXISTS construction_management_fee_pointer
    BEFORE UPDATE OF management_fee_amount,management_fee_basis,management_fee_version ON contracts
    WHEN (NEW.management_fee_version IS NULL AND (NEW.management_fee_amount IS NOT NULL OR NEW.management_fee_basis<>''))
      OR (NEW.management_fee_version IS NOT NULL AND (NEW.kind<>'施工' OR NOT EXISTS(
        SELECT 1 FROM construction_management_fee_history WHERE version=NEW.management_fee_version AND contract_id=NEW.id
          AND amount IS NEW.management_fee_amount AND basis=NEW.management_fee_basis)))
    BEGIN SELECT RAISE(ABORT,'管理费当前采用与冻结版本不一致'); END`)
}

export async function readNativeConstructionManagementFee(db: TransactionDb, id: string): Promise<ConstructionManagementFeeConfiguration> {
  const [row] = await db.select<{ kind: string, management_fee_amount: number | null, management_fee_basis: string, management_fee_version: string | null }>('SELECT kind, management_fee_amount, management_fee_basis, management_fee_version FROM contracts WHERE id=?', [id])
  if (!row || row.kind !== '施工')
    return emptyConstructionManagementFee()
  const history = await db.select<{ version: string, amount: number | null, basis: string, contractVersion: string, adoptedAt: string, actorId: string | null, commandId: string | null }>(`SELECT version,amount,basis,contract_version AS contractVersion,adopted_at AS adoptedAt,actor_id AS actorId,command_id AS commandId FROM construction_management_fee_history WHERE contract_id=? ORDER BY adopted_at,version`, [id])
  return decodeConstructionManagementFee({ amount: row.management_fee_amount, basis: row.management_fee_basis, version: row.management_fee_version, history })
}

/** 与主合同写入、操作日志和原件同一事务提交；历史只追加，撤销沿主合同旧指针恢复。 */
export async function persistNativeConstructionManagementFee(db: TransactionDb, id: string, configuration: ConstructionManagementFeeConfiguration): Promise<void> {
  const checked = decodeConstructionManagementFee(configuration)
  const [owner] = await db.select<{ kind: string }>('SELECT kind FROM contracts WHERE id=?', [id])
  if (!owner || owner.kind !== '施工')
    throw new Error('管理费配置仅适用于施工主合同')
  for (const snapshot of checked.history) {
    const [prior] = await db.select<{ contract_id: string, amount: number | null, basis: string, contract_version: string, adopted_at: string, actor_id: string | null, command_id: string | null }>('SELECT contract_id,amount,basis,contract_version,adopted_at,actor_id,command_id FROM construction_management_fee_history WHERE version=?', [snapshot.version])
    const fields = [id, snapshot.amount, snapshot.basis, snapshot.contractVersion, snapshot.adoptedAt, snapshot.actorId, snapshot.commandId]
    if (prior) {
      if (JSON.stringify([prior.contract_id, prior.amount, prior.basis, prior.contract_version, prior.adopted_at, prior.actor_id, prior.command_id]) !== JSON.stringify(fields))
        throw new Error('管理费冻结版本已存在且采用证据不一致')
      continue
    }
    await db.execute('INSERT INTO construction_management_fee_history(version,contract_id,amount,basis,contract_version,adopted_at,actor_id,command_id) VALUES (?,?,?,?,?,?,?,?)', [snapshot.version, ...fields])
  }
  await db.execute('UPDATE contracts SET management_fee_amount=?,management_fee_basis=?,management_fee_version=? WHERE id=? AND kind=?', [checked.amount, checked.basis, checked.version, id, '施工'])
}
