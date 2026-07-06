// #53 seed 演示数据完整性:设计稿 mock 转出的 JSON 与 schema/软删底座/金额铁律对齐。
// 用 fs 直读 JSON + 内存库实插(复刻 seed.ts 的 INSERT OR IGNORE 语义),不依赖浏览器端 seed.ts。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { columnNames, createMemoryDb, type TestDb } from '../helpers/memory-db'

type SeedRow = Record<string, unknown>

/** 与 app/lib/db/seed.ts 的 jsonTables 灌入顺序一致(父表先行) */
const SEED_TABLES = ['projects', 'suppliers', 'crews', 'workers', 'project_suppliers', 'invoices'] as const

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

  it('外键引用全部可解析(挂靠/发票/工人→班组/关联工人)', async () => {
    const projIds = new Set(loadSeed('projects').map(r => r.id))
    const supIds = new Set(loadSeed('suppliers').map(r => r.id))
    const crewIds = new Set(loadSeed('crews').map(r => r.id))
    const workerIds = new Set(loadSeed('workers').map(r => r.id))

    for (const ps of loadSeed('project_suppliers')) {
      expect(projIds).toContain(ps.project_id)
      expect(supIds).toContain(ps.supplier_id)
    }
    for (const inv of loadSeed('invoices')) {
      if (inv.project_id != null) expect(projIds).toContain(inv.project_id)
      if (inv.supplier_id != null) expect(supIds).toContain(inv.supplier_id)
    }
    for (const w of loadSeed('workers')) {
      if (w.crew_id != null) expect(crewIds).toContain(w.crew_id)
      if (w.linked_worker_id != null) expect(workerIds).toContain(w.linked_worker_id)
    }
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
  })
})

describe('seed 数据:灌入行为', () => {
  it('空库灌入:项目 12 条,分供方 5 条、发票 8 条(含各识别/归档状态)与设计稿 mock 一致', async () => {
    const db = await seededDb()
    const count = async (t: string) =>
      (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`))[0]!.n
    expect(await count('projects')).toBe(12)
    expect(await count('suppliers')).toBe(5)
    expect(await count('invoices')).toBe(8)
    expect(await count('crews')).toBe(6)
    expect(await count('workers')).toBe(8)
    expect(await count('project_suppliers')).toBe(5)

    // 识别/归档状态谱系齐备
    const states = await db.select<{ ocr_status: string, account_status: string, dup_status: string }>(
      'SELECT ocr_status, account_status, dup_status FROM invoices',
    )
    expect(new Set(states.map(s => s.ocr_status))).toEqual(new Set(['done', 'pending']))
    expect(new Set(states.map(s => s.account_status))).toEqual(new Set(['confirmed', 'none']))
    expect(states.some(s => s.dup_status === 'duplicate')).toBe(true)
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
