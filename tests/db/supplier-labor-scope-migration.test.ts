import { describe, expect, it } from 'vitest'
import { migrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb } from '../helpers/memory-db'

describe('分供方可选劳务范围迁移', () => {
  it('旧记录默认为空，幂等且不改变主营业务或人工资料状态', async () => {
    const db = await createMemoryDb()
    try {
      await db.execute('CREATE TABLE suppliers (id TEXT PRIMARY KEY, main_business TEXT, credential_status TEXT, credential_reviewed_at TEXT)')
      await db.execute('INSERT INTO suppliers VALUES (\'supplier-old\', \'不能猜成劳务范围\', \'qualified\', \'2026-09-08\')')
      const migration = migrations.find(item => item.name === 'supplier-independent-optional-labor-scope')!
      await migration.up(db)
      await migration.up(db)
      expect((await columnNames(db, 'suppliers')).filter(column => column === 'labor_scope')).toHaveLength(1)
      expect(await db.select('SELECT * FROM suppliers')).toEqual([{ id: 'supplier-old', main_business: '不能猜成劳务范围', credential_status: 'qualified', credential_reviewed_at: '2026-09-08', labor_scope: '' }])
      await db.execute('UPDATE suppliers SET labor_scope=\'石材安装\' WHERE id=\'supplier-old\'')
      expect(await db.select('SELECT credential_status, credential_reviewed_at FROM suppliers')).toEqual([{ credential_status: 'qualified', credential_reviewed_at: '2026-09-08' }])
    }
    finally {
      db.close()
    }
  })
})
