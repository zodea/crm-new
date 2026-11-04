import type { ProductionStorage } from '../../server/utils/production-storage'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { validateFinanceJournal } from '../../server/utils/production-finance-journal'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { PRODUCTION_STORAGE_SCHEMA, PRODUCTION_STORAGE_UPGRADES } from '../../server/utils/production-storage-schema'

it('真实付款申请新增、编辑、删除及重复删除各保留正确日志、软删状态与原号回执', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
  try {
    const identity = { workspaceId: 'action-review-workspace', actorId: 'action-review-owner' }
    db.exec(PRODUCTION_STORAGE_SCHEMA)
    db.prepare('INSERT INTO production_metadata VALUES(1,?,?,?,?,?)').run(1, identity.workspaceId, identity.actorId, 'verification', '2026-01-01T00:00:00.000Z')
    for (const upgrade of PRODUCTION_STORAGE_UPGRADES) {
      db.exec(upgrade.sql)
      db.prepare('UPDATE production_metadata SET schema_version=? WHERE singleton=1').run(upgrade.to)
    }
    const coordinator = createDbCoordinator(async () => ({
      async execute(sql, params) {
        if (params)
          db.prepare(sql).run(...params as never[])
        else db.exec(sql)
      },
      async select<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params as never[]) as T[] },
      async close() {},
    }))
    const storage = { ...coordinator, identity, assertBusinessWrite() {} } as ProductionStorage
    const actor = { ...identity, capabilities: ['finance-payment-application:read', 'finance-payment-application:write', 'finance-invoice:read'] }
    const session = () => structuredClone(actor)
    const finance = createProductionFinanceService(storage)
    const create = { ...identity, requiredCapability: 'finance-payment-application:write', kind: 'payment_application', action: 'draft', commandId: 'action-create', baseVersion: null, attachments: {}, draft: { name: '合成付款', bizType: '公司付款', applyAmount: 30, invoiceState: '无需发票' } }
    const first = await finance.execute(create, session)
    const edit = { ...create, commandId: 'action-edit', id: first.id, baseVersion: first.version, draft: { ...create.draft, id: first.id, name: '合成付款补充' } }
    const second = await finance.execute(edit, session)
    const remove = { ...create, action: 'delete', commandId: 'action-delete', id: first.id, baseVersion: second.version, draft: {} }
    const deleted = await finance.execute(remove, session)
    expect(await finance.execute(remove, session)).toEqual(deleted)
    const removeAgain = { ...remove, commandId: 'action-delete-again', baseVersion: deleted.version }
    const repeated = await finance.execute(removeAgain, session)
    expect(await finance.execute(removeAgain, session)).toEqual(repeated)
    const rows = db.prepare(`SELECT h.version,h.snapshot_json,c.request_json,c.result_json,l.action AS log_action
      FROM finance_history h JOIN finance_commands c ON c.command_id=h.command_id
      LEFT JOIN operation_logs l ON l.id=json_extract(c.result_json,'$.logId')
      WHERE h.kind='payment_application' AND h.id=? ORDER BY h.version`).all(first.id)
    expect(rows).toHaveLength(4)
    expect(rows.map(row => row.log_action)).toEqual(['create', 'update', 'delete', null])
    expect(rows.map(row => JSON.parse(String(row.request_json)).action)).toEqual(['draft', 'draft', 'delete', 'delete'])
    const heads = rows.map(row => JSON.parse(String(row.snapshot_json)).head)
    expect(heads[0].deleted_at).toBeNull()
    expect(heads[1].deleted_at).toBeNull()
    expect(typeof heads[2].deleted_at).toBe('string')
    expect(heads[3].deleted_at).toBe(heads[2].deleted_at)
    expect(repeated.logId).toBeNull()
    await expect(validateFinanceJournal(storage, actor)).resolves.toBeDefined()
  }
  finally { db.close() }
})
