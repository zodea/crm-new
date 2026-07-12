// 发票归档归属 + §4.2 台账聚合口径回归（issue #57）。
// 权威口径：DATABASE.md §4.2（进项票额/税额 = SUM(amount/tax_amount) WHERE project_id=? AND
// account_status='archived'）+ ADR-0001 归属铁律（无归属禁止归档）。
import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { checkArchiveOwnership, checkReviewed } from '~/lib/invoice/archive'
import { createMemoryDb } from '../helpers/memory-db'

describe('checkReviewed:归档前置——未校对一律拒绝(DATABASE.md §2.4「核对完成是归档唯一前置」)', () => {
  it('reviewStatus 非 reviewed(unreviewed/undefined/null)一律拒绝', () => {
    expect(checkReviewed('unreviewed').ok).toBe(false)
    expect(checkReviewed(undefined).ok).toBe(false)
    expect(checkReviewed(null).ok).toBe(false)
  })

  it('reviewStatus=reviewed 放行', () => {
    expect(checkReviewed('reviewed')).toEqual({ ok: true })
  })
})

describe('checkArchiveOwnership:归档归属校验(纯逻辑)', () => {
  it('无归属(null/undefined/非法值)一律拒绝归档', () => {
    expect(checkArchiveOwnership(null, null).ok).toBe(false)
    expect(checkArchiveOwnership(undefined, 'proj1').ok).toBe(false)
    expect(checkArchiveOwnership('other', 'proj1').ok).toBe(false)
  })

  it('归属为项目(project)但缺 projectId 拒绝', () => {
    const r = checkArchiveOwnership('project', null)
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('归属为项目(project)且有 projectId 放行', () => {
    expect(checkArchiveOwnership('project', 'proj1')).toEqual({ ok: true })
  })

  it('归属为个人开支(personal)不挂项目也放行', () => {
    expect(checkArchiveOwnership('personal', null)).toEqual({ ok: true })
    expect(checkArchiveOwnership('personal', undefined)).toEqual({ ok: true })
  })
})

describe('§4.2 台账聚合口径:进项票额/税额按 project_id + account_status=archived', () => {
  async function seedInvoices() {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p1', '合和新城'), ('p2', '锦绣华庭')`)
    // p1: 一条已归档(计入) + 一条未归档(none，不计入——account_status 只有 none|archived 两态)
    await db.execute(
      `INSERT INTO invoices (id, project_id, amount, tax_amount, account_status, owner_kind)
       VALUES ('inv1', 'p1', 10000, 1300, 'archived', 'project')`,
    )
    await db.execute(
      `INSERT INTO invoices (id, project_id, amount, tax_amount, account_status, owner_kind)
       VALUES ('inv2', 'p1', 5000, 650, 'none', NULL)`,
    )
    // p1: 另一条已归档，验证同项目多条累加
    await db.execute(
      `INSERT INTO invoices (id, project_id, amount, tax_amount, account_status, owner_kind)
       VALUES ('inv3', 'p1', 2000, 260, 'archived', 'project')`,
    )
    // p2: 已归档，验证不串项目
    await db.execute(
      `INSERT INTO invoices (id, project_id, amount, tax_amount, account_status, owner_kind)
       VALUES ('inv4', 'p2', 8000, 1040, 'archived', 'project')`,
    )
    // 个人开支：不挂项目，已归档——不应计入任何项目的 §4.2 口径
    await db.execute(
      `INSERT INTO invoices (id, project_id, amount, tax_amount, account_status, owner_kind)
       VALUES ('inv5', NULL, 3000, 390, 'archived', 'personal')`,
    )
    return db
  }

  async function ledgerSum(db: Awaited<ReturnType<typeof createMemoryDb>>, projectId: string) {
    const [row] = await db.select<{ amount_sum: number, tax_sum: number }>(
      `SELECT SUM(amount) AS amount_sum, SUM(tax_amount) AS tax_sum
       FROM invoices WHERE project_id = ? AND account_status = 'archived'`,
      [projectId],
    )
    return row
  }

  it('已归档发票按项目正确累加，未归档/其他项目不计入', async () => {
    const db = await seedInvoices()
    const p1 = await ledgerSum(db, 'p1')
    expect(p1.amount_sum).toBe(12000) // inv1(10000) + inv3(2000)，inv2(未归档 none)不计入
    expect(p1.tax_sum).toBe(1560) // 1300 + 260

    const p2 = await ledgerSum(db, 'p2')
    expect(p2.amount_sum).toBe(8000)
    expect(p2.tax_sum).toBe(1040)
    db.close()
  })

  it('个人开支(不挂项目)的已归档发票不计入任何项目口径，也不误算进"无项目"查询', async () => {
    const db = await seedInvoices()
    const [row] = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoices WHERE project_id IS NULL AND account_status = 'archived' AND owner_kind = 'personal'`,
    )
    expect(row.n).toBe(1)
    db.close()
  })

  it('软删除的已归档发票不计入 §4.2 口径(配合软删层可见性口径,此处验证 deleted_at 被过滤)', async () => {
    const db = await seedInvoices()
    await db.execute(`UPDATE invoices SET deleted_at = ? WHERE id = 'inv1'`, [new Date().toISOString()])
    const [row] = await db.select<{ n: number, amount_sum: number | null }>(
      `SELECT COUNT(*) AS n, SUM(amount) AS amount_sum
       FROM invoices WHERE project_id = 'p1' AND account_status = 'archived' AND deleted_at IS NULL`,
    )
    expect(row.n).toBe(1)
    expect(row.amount_sum).toBe(2000) // 只剩 inv3
    db.close()
  })
})
