import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { validateFinanceContractHistory } from '../../server/utils/production-finance-contract-history'
import { PRODUCTION_FINANCE_CONTRACT_UPGRADE } from '../../server/utils/production-finance-contract-upgrade'

it('升级保留旧付款身份未知，并验证新领域、编号和版本必须成对有效', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE production_participants(domain TEXT PRIMARY KEY, schema_version INTEGER NOT NULL);
      INSERT INTO production_participants VALUES('finance',1);
      CREATE TABLE payment_applications(id TEXT PRIMARY KEY, contract_id TEXT, company_expense_contract_id TEXT);
      INSERT INTO payment_applications VALUES('legacy','same-id',NULL);
      CREATE TABLE finance_history(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(kind,id,version));
      INSERT INTO finance_history VALUES('payment_application','legacy',1,'legacy-command','legacy-actor','2026-01-01T00:00:00.000Z','{"head":{"id":"legacy"}}');`)
    db.exec(PRODUCTION_FINANCE_CONTRACT_UPGRADE)
    expect(db.prepare('SELECT contract_id,contract_domain,contract_version FROM payment_applications WHERE id=?').get('legacy'))
      .toMatchObject({ contract_id: 'same-id', contract_domain: null, contract_version: null })
    expect(db.prepare('SELECT schema_version FROM production_participants WHERE domain=?').get('finance')).toMatchObject({ schema_version: 2 })
    expect(db.prepare('SELECT * FROM finance_contract_upgrade_anchor').all()).toEqual([{ singleton: 1, legacy_history_count: 1 }])
    expect(db.prepare('SELECT id,version,command_id,snapshot_json FROM finance_contract_legacy_history').all()).toEqual([{ id: 'legacy', version: 1, command_id: 'legacy-command', snapshot_json: '{"head":{"id":"legacy"}}' }])
    expect(() => db.prepare('DELETE FROM finance_contract_legacy_history').run()).toThrow('immutable')
    expect(() => db.prepare('UPDATE finance_contract_upgrade_anchor SET legacy_history_count=0').run()).toThrow('immutable')
    db.prepare('UPDATE payment_applications SET contract_domain=?,contract_version=? WHERE id=?').run('material', '1', 'legacy')
    expect(() => db.prepare('UPDATE payment_applications SET contract_domain=? WHERE id=?').run('company', 'legacy')).toThrow('CHECK constraint failed')
    expect(() => db.prepare('UPDATE payment_applications SET contract_version=? WHERE id=?').run('0', 'legacy')).toThrow('CHECK constraint failed')
    expect(() => db.prepare('UPDATE payment_applications SET contract_version=NULL WHERE id=?').run('legacy')).toThrow('CHECK constraint failed')
    db.prepare('INSERT INTO payment_applications(id,company_expense_contract_id,contract_domain,contract_version) VALUES(?,?,?,?)').run('company', 'same-id', 'company', '2')
  }
  finally {
    db.close()
  }
})

it('升级冻结旧付款申请及支付记录的精确版本，不能将同编号跨种类视为旧记录', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE production_metadata(singleton INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL);
      INSERT INTO production_metadata VALUES(1,31);
      CREATE TABLE production_participants(domain TEXT PRIMARY KEY,schema_version INTEGER NOT NULL);
      INSERT INTO production_participants VALUES('finance',1);
      CREATE TABLE payment_applications(id TEXT PRIMARY KEY,contract_id TEXT,company_expense_contract_id TEXT);
      CREATE TABLE finance_history(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(kind,id,version));
      INSERT INTO finance_history VALUES('payment_application','same-id',1,'application-old','actor','time','{"head":{"id":"same-id"}}');
      INSERT INTO finance_history VALUES('payment_record','same-id',1,'payment-old','actor','time','{"head":{"id":"same-id"}}');`)
    db.exec(PRODUCTION_FINANCE_CONTRACT_UPGRADE)
    const adapter = {
      async select<T>(sql: string, params: unknown[] = []) {
        return db.prepare(sql).all(...params as never[]) as T[]
      },
    }
    const boundary = await validateFinanceContractHistory(adapter)
    expect(boundary.isLegacy('same-id', 1)).toBe(true)
    expect(boundary.isLegacyFinance('payment_record', 'same-id', 1)).toBe(true)
    expect(boundary.isLegacyFinance('payment_record', 'same-id', 2)).toBe(false)
    expect(boundary.isLegacyFinance('payment_record', 'another-id', 1)).toBe(false)
    expect(db.prepare('SELECT legacy_history_count FROM finance_contract_upgrade_anchor').get()).toEqual({ legacy_history_count: 2 })
    db.exec('DROP TRIGGER finance_contract_legacy_history_no_delete; DELETE FROM finance_contract_legacy_history WHERE kind=\'payment_record\'')
    await expect(validateFinanceContractHistory(adapter)).rejects.toMatchObject({ problem: { code: 'unavailable', message: '付款合同升级边界或冻结历史证据损坏。' } })
  }
  finally { db.close() }
})

it.each(['missing', 'changed-bytes', 'changed-actor', 'new-missing-both', 'new-missing-one', 'forged'] as const)('升级边界拒绝%s，不把新历史当作旧历史', async (damage) => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE production_metadata(singleton INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL);
      INSERT INTO production_metadata VALUES(1,31);
      CREATE TABLE production_participants(domain TEXT PRIMARY KEY,schema_version INTEGER NOT NULL);
      INSERT INTO production_participants VALUES('finance',1);
      CREATE TABLE payment_applications(id TEXT PRIMARY KEY,contract_id TEXT,company_expense_contract_id TEXT);
      CREATE TABLE finance_history(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(kind,id,version));
      INSERT INTO finance_history VALUES('payment_application','old',1,'command','actor','time','{"head":{"id":"old"}}');`)
    db.exec(PRODUCTION_FINANCE_CONTRACT_UPGRADE)
    const adapter = {
      async select<T>(sql: string, params: unknown[] = []) {
        return db.prepare(sql).all(...params as never[]) as T[]
      },
    }
    expect((await validateFinanceContractHistory(adapter)).isLegacy('old', 1)).toBe(true)
    if (damage === 'missing') {
      db.exec('DROP TRIGGER finance_contract_legacy_history_no_delete; DELETE FROM finance_contract_legacy_history')
    }
    else if (damage === 'changed-bytes' || damage === 'changed-actor') {
      db.exec('DROP TRIGGER finance_contract_legacy_history_no_update')
      if (damage === 'changed-bytes')
        db.prepare('UPDATE finance_contract_legacy_history SET snapshot_json=?').run('{"head":{"id":"old","tampered":true}}')
      else db.prepare('UPDATE finance_contract_legacy_history SET actor_id=?').run('forged-actor')
    }
    else {
      const head = damage === 'new-missing-one'
        ? { id: 'new', contract_domain: null }
        : { id: 'new' }
      const snapshot = JSON.stringify({ head })
      db.prepare('INSERT INTO finance_history VALUES(?,?,?,?,?,?,?)').run('payment_application', 'new', 1, 'new-command', 'actor', 'time', snapshot)
      if (damage === 'forged') {
        db.exec('DROP TRIGGER finance_contract_legacy_history_no_insert')
        db.prepare('INSERT INTO finance_contract_legacy_history VALUES(?,?,?,?,?,?,?)').run('payment_application', 'new', 1, 'new-command', 'actor', 'time', snapshot)
      }
    }
    await expect(validateFinanceContractHistory(adapter)).rejects.toMatchObject({ problem: { code: 'unavailable', message: '付款合同升级边界或冻结历史证据损坏。' } })
  }
  finally { db.close() }
})

it('升级中途失败会回滚边界表、字段和旧历史', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE production_participants(domain TEXT PRIMARY KEY,schema_version INTEGER NOT NULL);
      INSERT INTO production_participants VALUES('finance',1);
      CREATE TABLE payment_applications(id TEXT PRIMARY KEY,contract_id TEXT,company_expense_contract_id TEXT);
      CREATE TABLE finance_history(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,command_id TEXT NOT NULL,actor_id TEXT NOT NULL,occurred_at TEXT NOT NULL,snapshot_json TEXT NOT NULL,PRIMARY KEY(kind,id,version));
      INSERT INTO finance_history VALUES('payment_application','old',1,'command','actor','time','{"head":{"id":"old"}}');`)
    const before = db.prepare('SELECT * FROM finance_history').all()
    db.exec('BEGIN')
    try {
      db.exec(PRODUCTION_FINANCE_CONTRACT_UPGRADE)
      expect(() => db.exec('INSERT INTO nonexistent_table VALUES(1)')).toThrow('no such table')
    }
    finally { db.exec('ROLLBACK') }
    expect(db.prepare('SELECT * FROM finance_history').all()).toEqual(before)
    expect(db.prepare('SELECT name FROM sqlite_schema WHERE name LIKE \'finance_contract_%\'').all()).toEqual([])
    expect(db.prepare('PRAGMA table_info(payment_applications)').all().map(column => column.name)).toEqual(['id', 'contract_id', 'company_expense_contract_id'])
    expect(db.prepare('SELECT schema_version FROM production_participants').get()).toEqual({ schema_version: 1 })
  }
  finally { db.close() }
})
