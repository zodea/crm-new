// #52 软删除+操作日志 数据层回归(权威口径:DATABASE.md §8 + ADR 0003 级联「只标父级」)
import type { MigrationDb } from '~/lib/db/migrations'
import { describe, expect, it } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import {
  BUSINESS_TABLES,
  createSoftDeleteActions,
  DEPRECATED_TABLES,
  downstreamImpact,
  fetchRowById,
  hiddenCtes,
  logCreate,
  logOperation,
  PARENT_REFS,
  restoreRecord,
  selectVisibleSql,
  softDelete,
  undoOperation,
  visibleCond,
  withUpdateLog,
} from '~/lib/db/soft-delete'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

interface OpLogRow {
  id: string
  table_name: string
  record_id: string
  action: string
  before_data: string | null
  after_data: string | null
  operator: string
}

async function logsFor(db: MigrationDb, table: string, recordId: string): Promise<OpLogRow[]> {
  return db.select<OpLogRow>(
    'SELECT * FROM operation_logs WHERE table_name = ? AND record_id = ? ORDER BY rowid',
    [table, recordId],
  )
}

/** 建库到最新版本并插入一条项目 */
async function dbWithProject(id = 'p1', name = '合和新城') {
  const db = await createMemoryDb()
  await runMigrations(db)
  await db.execute(`INSERT INTO projects (id, name) VALUES (?, ?)`, [id, name])
  return db
}

describe('v2 迁移:全业务表 deleted_at + operation_logs', () => {
  it('冷启动:全部业务表含 deleted_at 列,并建有软删部分索引', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    const indexes = (await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index'`,
    )).map(r => r.name)
    for (const t of BUSINESS_TABLES) {
      expect(await columnNames(db, t), `${t} 缺 deleted_at`).toContain('deleted_at')
      expect(indexes, `${t} 缺软删部分索引`).toContain(`idx_${t}_deleted`)
    }
    expect(indexes).toContain('idx_suppliers_parent')
    db.close()
  })

  it('operation_logs 表建立,含快照与操作人列', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    expect(await listTables(db)).toContain('operation_logs')
    const cols = await columnNames(db, 'operation_logs')
    for (const c of ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at']) {
      expect(cols).toContain(c)
    }
    db.close()
  })

  it('升级路径:v1 存量库全部业务表补列,存量行 deleted_at 为 NULL', async () => {
    const db = await createMemoryDb()
    // 只跑 v1 基线,模拟存量库
    await runMigrations(db, migrations.filter(m => m.version === 1))
    await db.execute(`INSERT INTO projects (id, name) VALUES (?, ?)`, ['p1', '老项目'])

    const result = await runMigrations(db)
    expect(result.from).toBe(1)
    expect(result.to).toBeGreaterThanOrEqual(2)
    for (const t of BUSINESS_TABLES) {
      expect(await columnNames(db, t), `${t} 升级后缺 deleted_at`).toContain('deleted_at')
    }
    const rows = await db.select<{ name: string, deleted_at: string | null }>(
      'SELECT name, deleted_at FROM projects',
    )
    expect(rows).toEqual([{ name: '老项目', deleted_at: null }])
    db.close()
  })
})

describe('父引用图与 schema 漂移校验', () => {
  it('schema 全部表 = 业务表 ∪ 废弃表 ∪ 基建表;每条父引用的列与父表真实存在', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    const tables = await listTables(db)
    const infra = ['schema_migrations', 'operation_logs']
    // schema 里每张表都必须有归属:业务表(登记进 PARENT_REFS)/ 废弃表 / 基建表
    for (const t of tables) {
      const known = BUSINESS_TABLES.includes(t) || DEPRECATED_TABLES.includes(t) || infra.includes(t)
      expect(known, `表 ${t} 未在 PARENT_REFS/DEPRECATED_TABLES 登记归属`).toBe(true)
    }
    // 登记的业务表必须物理存在;每条父引用的外键列真实存在、父表已登记
    for (const t of BUSINESS_TABLES) {
      expect(tables, `PARENT_REFS 登记了不存在的表 ${t}`).toContain(t)
      const cols = await columnNames(db, t)
      for (const ref of PARENT_REFS[t]!) {
        expect(cols, `${t} 父引用列 ${ref.column} 不存在`).toContain(ref.column)
        expect(BUSINESS_TABLES, `${t} 的父表 ${ref.table} 未登记`).toContain(ref.table)
      }
    }
    db.close()
  })
})

describe('软删除:删除不再执行 DELETE,restore 恢复', () => {
  it('softDelete 打 deleted_at 标记,物理行保留,落 delete 日志含删除前快照', async () => {
    const db = await dbWithProject()
    const logId = await softDelete(db, 'projects', 'p1', '张三')
    expect(logId).toBeTruthy()

    // 物理行仍在,只是打了标记
    const [row] = await db.select<{ id: string, deleted_at: string | null }>(
      'SELECT id, deleted_at FROM projects WHERE id = ?',
      ['p1'],
    )
    expect(row.id).toBe('p1')
    expect(row.deleted_at).not.toBeNull()

    const logs = await logsFor(db, 'projects', 'p1')
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('delete')
    expect(logs[0].operator).toBe('张三')
    const before = JSON.parse(logs[0].before_data!)
    expect(before.name).toBe('合和新城')
    expect(before.deleted_at).toBeNull()
    db.close()
  })

  it('softDelete 幂等:已删除/不存在的记录返回 null,不重复落日志', async () => {
    const db = await dbWithProject()
    await softDelete(db, 'projects', 'p1')
    expect(await softDelete(db, 'projects', 'p1')).toBeNull()
    expect(await softDelete(db, 'projects', '不存在')).toBeNull()
    expect(await logsFor(db, 'projects', 'p1')).toHaveLength(1)
    db.close()
  })

  it('restoreRecord 清 deleted_at,落 restore 日志含恢复后快照', async () => {
    const db = await dbWithProject()
    await softDelete(db, 'projects', 'p1')
    const logId = await restoreRecord(db, 'projects', 'p1')
    expect(logId).toBeTruthy()

    const [row] = await db.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM projects WHERE id = ?',
      ['p1'],
    )
    expect(row.deleted_at).toBeNull()

    const logs = await logsFor(db, 'projects', 'p1')
    expect(logs.map(l => l.action)).toEqual(['delete', 'restore'])
    const after = JSON.parse(logs[1].after_data!)
    expect(after.name).toBe('合和新城')
    db.close()
  })

  it('restoreRecord 幂等:未删除的记录返回 null,不落日志', async () => {
    const db = await dbWithProject()
    expect(await restoreRecord(db, 'projects', 'p1')).toBeNull()
    expect(await logsFor(db, 'projects', 'p1')).toHaveLength(0)
    db.close()
  })

  it('softDelete 拒绝未登记的表名', async () => {
    const db = await dbWithProject()
    await expect(softDelete(db, 'evil; DROP TABLE projects', 'p1')).rejects.toThrow()
    db.close()
  })
})

/** 可见查询(生产同款祝福读路径 selectVisibleSql) */
async function selectVisible(db: MigrationDb, table: string, orderBy = ''): Promise<Record<string, unknown>[]> {
  return db.select<Record<string, unknown>>(selectVisibleSql(table, orderBy))
}

describe('可见性:软删过滤 + 祖先过滤(ADR 0003)', () => {
  it('软删除后列表不可见;restore 后恢复原位(排序不变)', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name, created_at) VALUES ('p1', '一号', '2026-01-01'), ('p2', '二号', '2026-02-01'), ('p3', '三号', '2026-03-01')`)

    await softDelete(db, 'projects', 'p2')
    let rows = await selectVisible(db, 'projects', 'ORDER BY created_at')
    expect(rows.map(r => r.id)).toEqual(['p1', 'p3'])

    await restoreRecord(db, 'projects', 'p2')
    rows = await selectVisible(db, 'projects', 'ORDER BY created_at')
    expect(rows.map(r => r.id)).toEqual(['p1', 'p2', 'p3'])
    db.close()
  })

  it('统计查询同样带祖先过滤(COUNT 不含已删)', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p2', '二号')`)
    await softDelete(db, 'projects', 'p2')
    const [{ n }] = await db.select<{ n: number }>(
      `${hiddenCtes('projects')} SELECT COUNT(*) AS n FROM projects WHERE ${visibleCond('projects')}`,
    )
    expect(n).toBe(1)
    db.close()
  })

  it('级联只标父级:删项目后子级(挂靠/发票)隐藏,但子级自身 deleted_at 仍为 NULL', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO project_suppliers (id, project_id, supplier_id) VALUES ('ps1', 'p1', 's1')`)
    await db.execute(`INSERT INTO invoices (id, project_id, invoice_number) VALUES ('inv1', 'p1', 'FP001')`)

    await softDelete(db, 'projects', 'p1')

    // 子级查询不可见
    expect(await selectVisible(db, 'project_suppliers')).toHaveLength(0)
    expect(await selectVisible(db, 'invoices')).toHaveLength(0)

    // 但子级自身没有被打标记(只标父级)
    const [ps] = await db.select<{ deleted_at: string | null }>('SELECT deleted_at FROM project_suppliers WHERE id = ?', ['ps1'])
    const [inv] = await db.select<{ deleted_at: string | null }>('SELECT deleted_at FROM invoices WHERE id = ?', ['inv1'])
    expect(ps.deleted_at).toBeNull()
    expect(inv.deleted_at).toBeNull()

    // 日志只有父级一条 delete,子级无日志
    expect(await logsFor(db, 'project_suppliers', 'ps1')).toHaveLength(0)
    db.close()
  })

  it('恢复父级即整串重现;删父前已单删的子记录保持删除态', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO project_suppliers (id, project_id, supplier_id) VALUES ('ps1', 'p1', 's1'), ('ps2', 'p1', 's1')`)

    // 删父前先单删 ps2
    await softDelete(db, 'project_suppliers', 'ps2')
    await softDelete(db, 'projects', 'p1')
    expect(await selectVisible(db, 'project_suppliers')).toHaveLength(0)

    await restoreRecord(db, 'projects', 'p1')
    const rows = await selectVisible(db, 'project_suppliers')
    // ps1 自动重现;ps2 保持删除态不被误恢复
    expect(rows.map(r => r.id)).toEqual(['ps1'])
    db.close()
  })

  it('深链祖先过滤:删项目 → 挂靠隐藏 → 结算单(孙辈)也隐藏', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO project_suppliers (id, project_id, supplier_id) VALUES ('ps1', 'p1', 's1')`)
    await db.execute(`INSERT INTO settlements (id, project_supplier_id, final_amount) VALUES ('st1', 'ps1', 10000.5)`)

    expect(await selectVisible(db, 'settlements')).toHaveLength(1)
    await softDelete(db, 'projects', 'p1')
    expect(await selectVisible(db, 'settlements')).toHaveLength(0)

    await restoreRecord(db, 'projects', 'p1')
    expect(await selectVisible(db, 'settlements')).toHaveLength(1)
    db.close()
  })

  it('自引用祖先过滤:删父分供方,子/孙分供方隐藏且自身不打标记', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO suppliers (id, name, parent_supplier_id) VALUES ('s1', '总公司', NULL), ('s2', '分公司', 's1'), ('s3', '孙公司', 's2'), ('s9', '无关公司', NULL)`)

    await softDelete(db, 'suppliers', 's1')
    const rows = await selectVisible(db, 'suppliers')
    expect(rows.map(r => r.id)).toEqual(['s9'])

    await restoreRecord(db, 'suppliers', 's1')
    expect((await selectVisible(db, 'suppliers'))).toHaveLength(4)
    db.close()
  })

  it('nULL 父引用不误伤:未挂项目的发票不受任何项目删除影响', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO invoices (id, project_id, invoice_number) VALUES ('inv1', NULL, 'FP001')`)
    await softDelete(db, 'projects', 'p1')
    const rows = await selectVisible(db, 'invoices')
    expect(rows.map(r => r.id)).toEqual(['inv1'])
    db.close()
  })

  it('带别名的可见条件可嵌入 JOIN 查询', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO project_suppliers (id, project_id, supplier_id) VALUES ('ps1', 'p1', 's1')`)
    const sql = `${hiddenCtes('project_suppliers')}
      SELECT ps.id, p.name AS project_name
      FROM project_suppliers ps
      LEFT JOIN projects p ON ps.project_id = p.id
      WHERE ${visibleCond('project_suppliers', 'ps')}`
    expect(await db.select(sql)).toHaveLength(1)
    await softDelete(db, 'projects', 'p1')
    expect(await db.select(sql)).toHaveLength(0)
    db.close()
  })
})

describe('操作日志:create/update 也落账', () => {
  it('logOperation 写 create/update 日志,快照 JSON 可回读', async () => {
    const db = await dbWithProject()
    await logOperation(db, {
      table: 'projects',
      recordId: 'p1',
      action: 'create',
      after: await fetchRowById(db, 'projects', 'p1'),
    })
    await db.execute(`UPDATE projects SET name = ? WHERE id = ?`, ['改名后', 'p1'])
    await logOperation(db, {
      table: 'projects',
      recordId: 'p1',
      action: 'update',
      before: { name: '合和新城' },
      after: { name: '改名后' },
    })

    const logs = await logsFor(db, 'projects', 'p1')
    expect(logs.map(l => l.action)).toEqual(['create', 'update'])
    expect(JSON.parse(logs[0].after_data!).name).toBe('合和新城')
    expect(JSON.parse(logs[1].before_data!).name).toBe('合和新城')
    expect(JSON.parse(logs[1].after_data!).name).toBe('改名后')
    db.close()
  })
})

describe('写路径包装:logCreate / withUpdateLog', () => {
  it('logCreate 取整行快照落 create 日志;行不存在返回 null 不落账', async () => {
    const db = await dbWithProject()
    const logId = await logCreate(db, 'projects', 'p1')
    expect(logId).toBeTruthy()
    const logs = await logsFor(db, 'projects', 'p1')
    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0].after_data!).name).toBe('合和新城')

    expect(await logCreate(db, 'projects', '不存在')).toBeNull()
    db.close()
  })

  it('withUpdateLog 落前后快照;记录不存在/已删则不执行写入、不落幽灵日志', async () => {
    const db = await dbWithProject()
    const logId = await withUpdateLog(db, 'projects', 'p1', async () => {
      await db.execute(`UPDATE projects SET name = ? WHERE id = ?`, ['改名后', 'p1'])
    })
    expect(logId).toBeTruthy()
    const logs = await logsFor(db, 'projects', 'p1')
    expect(JSON.parse(logs[0].before_data!).name).toBe('合和新城')
    expect(JSON.parse(logs[0].after_data!).name).toBe('改名后')

    // 不存在的 id:mutate 不执行、无日志
    let ran = false
    expect(await withUpdateLog(db, 'projects', '不存在', async () => {
      ran = true
    })).toBeNull()
    expect(ran).toBe(false)
    expect(await logsFor(db, 'projects', '不存在')).toHaveLength(0)

    // 已软删的记录同样拒绝编辑
    await softDelete(db, 'projects', 'p1')
    expect(await withUpdateLog(db, 'projects', 'p1', async () => {
      ran = true
    })).toBeNull()
    expect(ran).toBe(false)
    db.close()
  })
})

describe('撤回:undoOperation 按日志反做(DATABASE.md §8.3)', () => {
  it('撤回删除 = restore,记录重新可见并落补偿日志', async () => {
    const db = await dbWithProject()
    const logId = await softDelete(db, 'projects', 'p1')
    expect(await undoOperation(db, logId!)).toBe(true)

    expect(await selectVisible(db, 'projects')).toHaveLength(1)
    const logs = await logsFor(db, 'projects', 'p1')
    expect(logs.map(l => l.action)).toEqual(['delete', 'restore'])
    db.close()
  })

  it('撤回新增 = 软删除', async () => {
    const db = await dbWithProject()
    const logId = await logOperation(db, {
      table: 'projects',
      recordId: 'p1',
      action: 'create',
      after: await fetchRowById(db, 'projects', 'p1'),
    })
    expect(await undoOperation(db, logId)).toBe(true)
    expect(await selectVisible(db, 'projects')).toHaveLength(0)
    db.close()
  })

  it('撤回编辑 = 回写 before_data 字段值', async () => {
    const db = await dbWithProject()
    const before = await fetchRowById(db, 'projects', 'p1')
    await db.execute(`UPDATE projects SET name = ?, status = ? WHERE id = ?`, ['改名后', '施工中', 'p1'])
    const logId = await logOperation(db, {
      table: 'projects',
      recordId: 'p1',
      action: 'update',
      before,
      after: await fetchRowById(db, 'projects', 'p1'),
    })

    expect(await undoOperation(db, logId)).toBe(true)
    const row = await fetchRowById(db, 'projects', 'p1')
    expect(row!.name).toBe('合和新城')
    expect(row!.status).toBe('筹备中')
    db.close()
  })

  it('撤回恢复 = 再次软删除', async () => {
    const db = await dbWithProject()
    await softDelete(db, 'projects', 'p1')
    const logId = await restoreRecord(db, 'projects', 'p1')
    expect(await undoOperation(db, logId!)).toBe(true)
    expect(await selectVisible(db, 'projects')).toHaveLength(0)
    db.close()
  })

  it('未知日志 id 返回 false,不改任何数据', async () => {
    const db = await dbWithProject()
    expect(await undoOperation(db, '不存在')).toBe(false)
    expect(await selectVisible(db, 'projects')).toHaveLength(1)
    db.close()
  })

  it('撤回编辑不触碰生死状态:先编辑后删除,撤回编辑不复活记录', async () => {
    const db = await dbWithProject()
    const editLogId = await withUpdateLog(db, 'projects', 'p1', async () => {
      await db.execute(`UPDATE projects SET name = ? WHERE id = ?`, ['改名后', 'p1'])
    })
    await softDelete(db, 'projects', 'p1')

    // 撤回那次编辑:字段回写,但 deleted_at 不被回写为 NULL
    expect(await undoOperation(db, editLogId!)).toBe(true)
    const row = await fetchRowById(db, 'projects', 'p1')
    expect(row!.name).toBe('合和新城')
    expect(row!.deleted_at).not.toBeNull()
    expect(await selectVisible(db, 'projects')).toHaveLength(0)
    db.close()
  })

  it('日志快照损坏(非法 JSON / 不存在的列)返回 false 而非抛异常', async () => {
    const db = await dbWithProject()
    await db.execute(
      `INSERT INTO operation_logs (id, table_name, record_id, action, before_data) VALUES (?, ?, ?, ?, ?)`,
      ['bad1', 'projects', 'p1', 'update', '{坏 json'],
    )
    expect(await undoOperation(db, 'bad1')).toBe(false)

    // 快照含库中不存在的列(如被后续迁移移除):SQL 报错被捕获,优雅拒绝
    await db.execute(
      `INSERT INTO operation_logs (id, table_name, record_id, action, before_data) VALUES (?, ?, ?, ?, ?)`,
      ['bad2', 'projects', 'p1', 'update', '{"ghost_column": 1}'],
    )
    expect(await undoOperation(db, 'bad2')).toBe(false)
    db.close()
  })
})

describe('createSoftDeleteActions:store 软删三连工厂', () => {
  it('remove/restore 后重载;undo 仅成功时重载', async () => {
    const db = await dbWithProject()
    let reloads = 0
    const actions = createSoftDeleteActions(db, 'projects', async () => {
      reloads++
    })

    const logId = await actions.remove('p1')
    expect(logId).toBeTruthy()
    expect(reloads).toBe(1)
    expect(await selectVisible(db, 'projects')).toHaveLength(0)

    expect(await actions.undo(logId!)).toBe(true)
    expect(reloads).toBe(2)
    expect(await selectVisible(db, 'projects')).toHaveLength(1)

    expect(await actions.undo('不存在')).toBe(false)
    expect(reloads).toBe(2) // 失败不重载

    await actions.remove('p1')
    expect(await actions.restore('p1')).toBeTruthy()
    expect(await selectVisible(db, 'projects')).toHaveLength(1)
    db.close()
  })

  it('未登记的表直接拒绝(含 ADR-0001 废弃表)', async () => {
    const db = await dbWithProject()
    expect(() => createSoftDeleteActions(db, 'ticket_registrations', async () => {})).toThrow('未登记')
    db.close()
  })
})

describe('downstreamImpact:通用下游杀伤统计(#89 由 stores/project.ts 内联上移)', () => {
  it('suppliers 建父 + 若干可见子,按可见集计数,只含 n>0 的项', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO invoices (id, supplier_id, invoice_number) VALUES ('inv1', 's1', 'FP001'), ('inv2', 's1', 'FP002')`)
    await db.execute(`INSERT INTO supplier_credentials (id, supplier_id, category) VALUES ('c1', 's1', '营业执照')`)

    const impact = await downstreamImpact(db, 'suppliers', 's1')
    expect(impact).toEqual(expect.arrayContaining([
      { table: 'invoices', n: 2 },
      { table: 'supplier_credentials', n: 1 },
    ]))
    // 无数据的子表(project_suppliers/expenditure_contracts/contracts/payment_applications)不出现
    expect(impact.map(i => i.table).sort()).toEqual(['invoices', 'supplier_credentials'])
    db.close()
  })

  it('兄弟祖先隐藏:发票的另一父(项目)被删 → 不计入分供方的杀伤清单(可见集口径)', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO invoices (id, project_id, supplier_id, invoice_number) VALUES ('inv1', 'p1', 's1', 'FP001')`)

    expect(await downstreamImpact(db, 'suppliers', 's1')).toEqual([{ table: 'invoices', n: 1 }])
    await softDelete(db, 'projects', 'p1')
    // 发票因项目祖先被删而隐藏,分供方杀伤清单不应再计入它
    expect(await downstreamImpact(db, 'suppliers', 's1')).toEqual([])
    db.close()
  })

  it('无下游数据返回空数组(驱动 UI 走 simple 删除)', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '孤家寡人')`)
    expect(await downstreamImpact(db, 'suppliers', 's1')).toEqual([])
    db.close()
  })

  it('自引用不被通用层特殊排除:suppliers 自身(parent_supplier_id)有真实下游时如实计入', async () => {
    // 通用层保持"域无关":是否展示自引用杀伤是调用方（业务域）的判断，不在共享 downstreamImpact 里硬编码。
    // 分供方域"无母子挂靠、不展示自引用"的过滤见 stores/supplier.ts 的 downstreamImpact 包装。
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO suppliers (id, name, parent_supplier_id) VALUES ('s1', '总公司', NULL), ('s2', '分公司', 's1'), ('s3', '孙公司', 's2')`)
    const impact = await downstreamImpact(db, 'suppliers', 's1')
    // 直接子表计数(一跳):仅'分公司'(parent_supplier_id='s1'),不含递归孙辈
    expect(impact).toContainEqual({ table: 'suppliers', n: 1 })
    db.close()
  })

  it('parentTable=projects 回归:与域①现有行为一致(保证回退复用不破坏项目域)', async () => {
    const db = await dbWithProject()
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '华东建材')`)
    await db.execute(`INSERT INTO project_suppliers (id, project_id, supplier_id) VALUES ('ps1', 'p1', 's1')`)
    await db.execute(`INSERT INTO invoices (id, project_id, invoice_number) VALUES ('inv1', 'p1', 'FP001')`)

    const impact = await downstreamImpact(db, 'projects', 'p1')
    expect(impact.map(i => i.table).sort()).toEqual(['invoices', 'project_suppliers'])
    expect(await downstreamImpact(db, 'projects', '不存在')).toEqual([])
    db.close()
  })
})
