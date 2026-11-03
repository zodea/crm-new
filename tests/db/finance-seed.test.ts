import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedIfEmpty } from '~/lib/db/seed'
import { getPaymentApplicationSummary } from '~/lib/finance/domain'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
})

afterEach(() => db.close())

describe('付款种子与业务汇总', () => {
  it('把已付金额保存在已确认支付记录与付款申请分摊中', async () => {
    await seedIfEmpty(db)

    const applications = await db.select<{ id: string }>('SELECT id FROM payment_applications WHERE supplier_id=? AND deleted_at IS NULL ORDER BY id', ['sup_demo_004'])
    expect(applications).toEqual([{ id: 'pa_demo_sup004_1' }, { id: 'pa_demo_sup004_2' }])
    // 原有供应商 101138 元拆为两项固定断言；只用业务读取计算每项，避免测试自写聚合。
    expect(await Promise.all(applications.map(async ({ id }) => (await getPaymentApplicationSummary(id, db)).paidAmount))).toEqual([80000, 21138])
    expect((await getPaymentApplicationSummary('pa_mz0x1_0', db)).paidAmount).toBe(4200000)
    expect(await db.select<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([])
  })

  it('合成申请只汇总自身已确认支付分摊，未确认付款和另一申请不混入', async () => {
    await db.execute('INSERT INTO payment_applications(id,name,apply_amount,invoice_state,status) VALUES(\'a\',\'申请甲\',200,\'先款后票\',\'submitted\'),(\'b\',\'申请乙\',50,\'先款后票\',\'submitted\')')
    await db.execute('INSERT INTO payment_records(id,no,amount,confirmation_status,payment_date,payee_name,voucher_no,bank_serial_no) VALUES(\'a1\',\'合成付款1\',80,\'needs_review\',\'2026-08-01\',\'收款人\',\'v1\',\'s1\'),(\'a2\',\'合成付款2\',20,\'needs_review\',\'2026-08-01\',\'收款人\',\'v2\',\'s2\'),(\'pending\',\'待核付款\',30,\'needs_review\',\'2026-08-01\',\'收款人\',\'v3\',\'s3\'),(\'b1\',\'另一付款\',50,\'needs_review\',\'2026-08-01\',\'收款人\',\'v4\',\'s4\')')
    await db.execute('INSERT INTO payment_record_application_allocations(id,payment_record_id,payment_application_id,allocated_amount) VALUES(\'a1-line\',\'a1\',\'a\',80),(\'a2-line\',\'a2\',\'a\',20),(\'pending-line\',\'pending\',\'a\',30),(\'b1-line\',\'b1\',\'b\',50)')
    await db.execute('UPDATE payment_records SET confirmation_status=\'confirmed\',confirmed_by=\'经办\',confirmed_at=\'2026-08-01T00:00:00Z\' WHERE id IN (\'a1\',\'a2\',\'b1\')')
    expect((await getPaymentApplicationSummary('a', db)).paidAmount).toBe(100)
    expect((await getPaymentApplicationSummary('b', db)).paidAmount).toBe(50)
    expect(await db.select<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([])
  })
})
