import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { inspectProductionBackup } from '../../server/utils/production-backup-manifest'
import { createProductionStorage } from '../../server/utils/production-storage'

it.each([
  ['finance_history_no_delete', 'drop'],
  ['crew_worker_import_sources_immutable_update', 'replace'],
  ['worker_roster_archives_immutable_delete', 'drop'],
  ['trg_payment_confirmation_balanced', 'condition-case'],
  ['finance_payment_verifications_no_update', 'replace-verification'],
  ['finance_payment_verifications_no_delete', 'drop'],
  ['finance_expense_clearance_verifications_no_update', 'replace-clearance'],
  ['finance_expense_clearance_verifications_no_delete', 'drop'],
  ['expenditure_settlement_clearance_links_no_update', 'replace-clearance-link'],
  ['expenditure_settlement_clearance_links_no_delete', 'drop'],
] as const)('真实盘历史保护 %s 缺失或被替换时冷启动和备份均拒绝，不重建保护冒充原库完整', async (guard, damage) => {
  const base = resolve('.tmp/root-clearance-validation/schema-evidence')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'guard-'))
  const options = { directory, workspaceId: 'schema-evidence-workspace', ownerId: 'schema-evidence-owner', purpose: 'verification' as const }
  const storage = createProductionStorage(options)
  const snapshot = join(directory, 'complete.sqlite')
  await storage.getDb()
  await storage.backupTo(snapshot)
  await expect(inspectProductionBackup(snapshot)).resolves.toMatchObject({ workspaceId: options.workspaceId })
  await storage.close()
  const source = join(directory, 'ruihang.sqlite')
  for (const path of [source, snapshot]) {
    const db = new DatabaseSync(path)
    try {
      const original = db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(guard)
      expect(original?.sql).toContain('RAISE')
      db.exec(`DROP TRIGGER ${guard}`)
      if (damage === 'replace')
        db.exec(`CREATE TRIGGER ${guard} BEFORE UPDATE ON crew_worker_import_sources BEGIN SELECT 1; END`)
      if (damage === 'replace-verification')
        db.exec(`CREATE TRIGGER ${guard} BEFORE UPDATE ON finance_payment_verifications BEGIN SELECT 1; END`)
      if (damage === 'replace-clearance')
        db.exec(`CREATE TRIGGER ${guard} BEFORE UPDATE ON finance_expense_clearance_verifications BEGIN SELECT 1; END`)
      if (damage === 'replace-clearance-link')
        db.exec(`CREATE TRIGGER ${guard} BEFORE UPDATE ON expenditure_settlement_clearance_links BEGIN SELECT 1; END`)
      if (damage === 'condition-case')
        db.exec(String(original!.sql).replaceAll('\'confirmed\'', '\'CONFIRMED\''))
    }
    finally { db.close() }
  }
  await expect(inspectProductionBackup(snapshot)).rejects.toThrow(/历史保护/)
  const reopened = createProductionStorage(options)
  try {
    await expect(reopened.getDb()).rejects.toThrow(/历史保护/)
  }
  finally { await reopened.close().catch(() => undefined) }
  const unchanged = new DatabaseSync(source, { readOnly: true })
  try {
    const damagedSql = unchanged.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(guard)?.sql ?? null
    if (damage === 'condition-case') {
      expect(damagedSql).toContain('NEW.confirmation_status = \'CONFIRMED\'')
      expect(damagedSql).not.toContain('\'confirmed\'')
    }
    else {
      const damagedTable = damage === 'replace-verification' ? 'finance_payment_verifications' : damage === 'replace-clearance' ? 'finance_expense_clearance_verifications' : damage === 'replace-clearance-link' ? 'expenditure_settlement_clearance_links' : 'crew_worker_import_sources'
      expect(damagedSql).toEqual(damage === 'drop' ? null : `CREATE TRIGGER ${guard} BEFORE UPDATE ON ${damagedTable} BEGIN SELECT 1; END`)
    }
    expect(unchanged.prepare('SELECT revision FROM finance_revision WHERE singleton=1').get()?.revision).toBe(0)
    expect(unchanged.prepare('SELECT count(*) AS total FROM crew_worker_import_sources').get()?.total).toBe(0)
  }
  finally { unchanged.close() }
})
