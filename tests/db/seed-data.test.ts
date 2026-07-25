import type { TestDb } from '../helpers/memory-db'
// #53 seed 演示数据完整性:设计稿 mock 转出的 JSON 与 schema/软删底座/金额铁律对齐。
// 用 fs 直读 JSON + 内存库实插(复刻 seed.ts 的 INSERT OR IGNORE 语义),不依赖浏览器端 seed.ts。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { columnNames, createMemoryDb } from '../helpers/memory-db'

type SeedRow = Record<string, unknown>

/** 与 app/lib/db/seed.ts 的 jsonTables 灌入顺序一致(父表先行) */
const SEED_TABLES = ['customers', 'projects', 'suppliers', 'crews', 'workers', 'project_suppliers', 'invoices', 'contracts', 'delivery_records', 'delivery_lines'] as const

function loadSeed(table: string): SeedRow[] {
  const url = new URL(`../../app/lib/db/seed/${table}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf-8'))
}

/** 复刻 seed.ts 的 seedFromJson:INSERT OR IGNORE 按行列名直插 */
async function insertRows(db: TestDb, table: string, rows: SeedRow[]) {
  for (const row of rows) {
    const cols = Object.keys(row)
    await db.execute(
      `INSERT OR IGNORE INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => row[c]),
    )
  }
}

async function seededDb(): Promise<TestDb> {
  const db = await createMemoryDb()
  await runMigrations(db)
  for (const t of SEED_TABLES) await insertRows(db, t, loadSeed(t))
  return db
}

const round2 = (n: number) => Math.round(n * 100) / 100

describe('seed 数据:结构与 schema 对齐', () => {
  it('每张 seed 表的行列名都是真实列;不带 deleted_at(默认 NULL 过软删过滤)', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    for (const t of SEED_TABLES) {
      const cols = await columnNames(db, t)
      for (const row of loadSeed(t)) {
        for (const key of Object.keys(row)) {
          expect(cols, `${t} 出现未知列 ${key}`).toContain(key)
        }
        expect(row, `${t} 不应显式写 deleted_at`).not.toHaveProperty('deleted_at')
      }
    }
    db.close()
  })

  it('外键引用全部可解析(客户/发票/工人→班组与项目/关联工人)', async () => {
    const customerIds = new Set(loadSeed('customers').map(r => r.id))
    const projIds = new Set(loadSeed('projects').map(r => r.id))
    const supIds = new Set(loadSeed('suppliers').map(r => r.id))
    const crewIds = new Set(loadSeed('crews').map(r => r.id))
    const workerIds = new Set(loadSeed('workers').map(r => r.id))

    for (const project of loadSeed('projects')) {
      if (project.customer_id != null)
        expect(customerIds).toContain(project.customer_id)
      if (project.secondary_customer_id != null)
        expect(customerIds).toContain(project.secondary_customer_id)
    }
    for (const ps of loadSeed('project_suppliers')) {
      expect(projIds).toContain(ps.project_id)
      expect(supIds).toContain(ps.supplier_id)
    }
    for (const inv of loadSeed('invoices')) {
      if (inv.project_id != null)
        expect(projIds).toContain(inv.project_id)
      if (inv.supplier_id != null)
        expect(supIds).toContain(inv.supplier_id)
    }
    for (const w of loadSeed('workers')) {
      if (w.crew_id != null)
        expect(crewIds).toContain(w.crew_id)
      if (w.current_project_id != null)
        expect(projIds).toContain(w.current_project_id)
      if (w.linked_worker_id != null)
        expect(workerIds).toContain(w.linked_worker_id)
    }
    for (const c of loadSeed('contracts')) {
      expect(projIds).toContain(c.project_id)
      if (c.supplier_id != null)
        expect(supIds).toContain(c.supplier_id)
    }
    const deliveryIds = new Set(loadSeed('delivery_records').map(r => r.id))
    for (const record of loadSeed('delivery_records')) {
      expect(projIds).toContain(record.project_id)
      if (record.supplier_id != null)
        expect(supIds).toContain(record.supplier_id)
    }
    for (const line of loadSeed('delivery_lines'))
      expect(deliveryIds).toContain(line.delivery_record_id)
  })

  it('金额铁律:两位小数;发票 不含税+税额=价税合计', () => {
    for (const p of loadSeed('projects')) {
      if (typeof p.contract_amount === 'number') {
        expect(p.contract_amount, `项目 ${p.name} 金额超两位小数`).toBe(round2(p.contract_amount))
      }
    }
    for (const inv of loadSeed('invoices')) {
      const amount = inv.amount as number
      const tax = inv.tax_amount as number
      const total = inv.total_amount as number
      for (const [k, v] of [['amount', amount], ['tax_amount', tax], ['total_amount', total]] as const) {
        expect(v, `发票 ${inv.id} ${k} 超两位小数`).toBe(round2(v))
      }
      expect(round2(amount + tax), `发票 ${inv.id} 价税不平`).toBe(total)
    }
    for (const c of loadSeed('contracts')) {
      for (const k of ['amount', 'changed', 'settled', 'invoiced', 'paid'] as const) {
        const v = c[k] as number
        expect(v, `合同 ${c.id} ${k} 超两位小数`).toBe(round2(v))
      }
    }
    for (const line of loadSeed('delivery_lines')) {
      const qty = line.qty as number
      const price = line.unit_price as number
      expect(line.amount, `送货单明细 ${line.id} 金额不平`).toBe(round2(qty * price))
    }
  })
})

describe('seed 数据:灌入行为', () => {
  it('空库灌入:项目 12 条,分供方 10 条(#90 批A 含乙方 s6–s10)、发票 8 条、合同 31 份与设计稿 mock 一致', async () => {
    const db = await seededDb()
    const count = async (t: string) =>
      (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`))[0]!.n
    expect(await count('projects')).toBe(12)
    expect(await count('suppliers')).toBe(10)
    expect(await count('invoices')).toBe(8)
    expect(await count('crews')).toBe(6)
    expect(await count('workers')).toBe(8)
    expect(await count('project_suppliers')).toBe(5)
    expect(await count('contracts')).toBe(31)
    expect(await count('delivery_records')).toBe(3)
    expect(await count('delivery_lines')).toBe(4)

    // 识别/归档状态谱系齐备：account_status 两态 none(未归档)/archived(已归档，DATABASE.md §2.4 权威定义，
    // 无 confirmed 中间值——「确认」由 review_status 独立承载，见 #57)
    const states = await db.select<{ ocr_status: string, review_status: string, account_status: string, dup_status: string }>(
      'SELECT ocr_status, review_status, account_status, dup_status FROM invoices',
    )
    expect(new Set(states.map(s => s.ocr_status))).toEqual(new Set(['done', 'pending']))
    expect(new Set(states.map(s => s.account_status))).toEqual(new Set(['none', 'archived']))
    // 谱系含"已校对未归档"过渡态样例(reviewed + none)，否则台账「待归档」分组无法演示
    expect(states.some(s => s.review_status === 'reviewed' && s.account_status === 'none')).toBe(true)
    expect(states.some(s => s.dup_status === 'duplicate')).toBe(true)
    db.close()
  })

  it('§4.2 台账口径：已归档发票的归属字段齐备(owner_kind 非空, project 归属带 project_id)', async () => {
    const db = await seededDb()
    const archived = await db.select<{ owner_kind: string | null, project_id: string | null }>(
      `SELECT owner_kind, project_id FROM invoices WHERE account_status = 'archived'`,
    )
    expect(archived.length, 'seed 里应至少有一条已归档发票,否则 §4.2 聚合口径无法演示').toBeGreaterThan(0)
    for (const row of archived) {
      expect(row.owner_kind, '已归档发票不应缺归属').not.toBeNull()
      if (row.owner_kind === 'project')
        expect(row.project_id, 'owner_kind=project 的已归档发票必须挂具体项目').not.toBeNull()
    }
    db.close()
  })

  it('重复灌入幂等:同一批 JSON 再插一遍,行数不变', async () => {
    const db = await seededDb()
    for (const t of SEED_TABLES) await insertRows(db, t, loadSeed(t))
    const [{ n }] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM projects')
    expect(n).toBe(12)
    db.close()
  })

  it('seed 数据全部通过软删除底座默认过滤(可见查询数 = 灌入数)', async () => {
    const db = await seededDb()
    for (const t of SEED_TABLES) {
      const visible = await db.select(selectVisibleSql(t))
      expect(visible.length, `${t} 有 seed 行被软删过滤挡住`).toBe(loadSeed(t).length)
    }
    db.close()
  })
})
