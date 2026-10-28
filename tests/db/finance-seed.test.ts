import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMigratedMemoryDb()
})

afterEach(() => db.close())

describe('资金演示 seed', () => {
  it('把已付金额保存在已确认支付记录与付款申请分摊中', async () => {
    await seedIfEmpty(db)

    const [supplierPayment] = await db.select<{ paid_total: number }>(`
      SELECT COALESCE(SUM(allocation.allocated_amount), 0) AS paid_total
      FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS payment
        ON payment.id = allocation.payment_record_id
      JOIN payment_applications AS application
        ON application.id = allocation.payment_application_id
      WHERE application.supplier_id = 'sup_demo_004'
        AND payment.confirmation_status = 'confirmed'
        AND allocation.deleted_at IS NULL
        AND payment.deleted_at IS NULL
        AND application.deleted_at IS NULL
    `)
    expect(supplierPayment?.paid_total).toBe(101138)

    const [projectPayment] = await db.select<{ paid_total: number }>(`
      SELECT COALESCE(SUM(allocation.allocated_amount), 0) AS paid_total
      FROM payment_record_application_allocations AS allocation
      JOIN payment_records AS payment
        ON payment.id = allocation.payment_record_id
      JOIN payment_applications AS application
        ON application.id = allocation.payment_application_id
      WHERE application.id = 'pa_mz0x1_0'
        AND payment.confirmation_status = 'confirmed'
        AND allocation.deleted_at IS NULL
        AND payment.deleted_at IS NULL
        AND application.deleted_at IS NULL
    `)
    expect(projectPayment?.paid_total).toBe(4200000)
    expect(await db.select<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([])
  })
})
