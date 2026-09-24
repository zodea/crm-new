import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useFinanceStore } from '~/stores/finance'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb
vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => db.execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params),
  withTransaction: async <T>(work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>) => {
    await db.execute('BEGIN')
    try {
      const result = await work(db)
      await db.execute('COMMIT')
      return result
    }
    catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  setActivePinia(createPinia())
})
afterEach(() => db.close())

describe('付款批复输入意图', () => {
  it('保存域拒绝负数与非有限输入，失败后仍保留原金额与来源', async () => {
    const store = useFinanceStore()
    const saved = await store.saveForm('payment_application', { name: '批复校验', bizType: '公司付款', applyAmount: 100 }, 'draft')
    const original = await store.loadOne('payment_application', saved.id)
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(store.saveForm('payment_application', { ...original, approvedAmount: value, approvedAmountEdit: { value } }, 'draft')).rejects.toThrow('非负有效金额')
      expect(await store.loadOne('payment_application', saved.id)).toMatchObject({ approvedAmount: null, approvedAmountOrigin: 'user-entry' })
    }
  })
  it('整单保存不确认历史来源，明确重填零或清空才更新，失败不留下修改', async () => {
    const store = useFinanceStore()
    await db.execute('INSERT INTO payment_applications (id, name, biz_type, apply_amount, approved_amount) VALUES (\'legacy\', \'历史记录\', \'公司付款\', 100, 0)')
    const original = await store.loadOne('payment_application', 'legacy')
    await store.saveForm('payment_application', { ...original, approvalNote: '仅改备注', approvedAmountOrigin: 'user-entry' }, 'draft')
    expect(await store.loadOne('payment_application', 'legacy')).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy' })
    await expect(store.saveForm('payment_application', { ...original, approvedAmount: 20 }, 'draft')).rejects.toThrow('需要明确输入')
    await expect(store.saveForm('payment_application', { ...original, approvedAmount: 0, approvedAmountEdit: { value: 20 } }, 'draft')).rejects.toThrow('不一致')
    await db.execute('CREATE TRIGGER payment_approval_save_failure BEFORE INSERT ON file_refs BEGIN SELECT RAISE(ABORT, \'模拟附件保存失败\'); END')
    await expect(store.saveForm('payment_application', { ...original, approvedAmount: null, approvedAmountEdit: { value: null } }, 'draft', {
      add: [{ fileName: '回滚凭据.txt', mimeType: 'text/plain', fileSize: 1, payloadBase64: 'WA==' }],
    })).rejects.toThrow('模拟附件保存失败')
    await db.execute('DROP TRIGGER payment_approval_save_failure')
    expect(await store.loadOne('payment_application', 'legacy')).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'legacy', approvalNote: '仅改备注' })
    await store.saveForm('payment_application', { ...original, approvedAmount: 0, approvedAmountEdit: { value: 0 } }, 'draft')
    expect(await store.loadOne('payment_application', 'legacy')).toMatchObject({ approvedAmount: 0, approvedAmountOrigin: 'user-entry' })
    await store.saveForm('payment_application', { ...original, approvedAmount: null, approvedAmountEdit: { value: null } }, 'draft')
    expect(await store.loadOne('payment_application', 'legacy')).toMatchObject({ approvedAmount: null, approvedAmountOrigin: 'user-entry' })
  })

  it('明确零拒绝支付，空批复按申请额校验，旧零保持原确认兼容且不更改来源', async () => {
    const store = useFinanceStore()
    for (const [id, value, origin] of [['zero', 0, 'user-entry'], ['empty', null, 'user-entry'], ['legacy', 0, 'legacy'], ['known', 80, 'user-entry']] as const) {
      await db.execute('INSERT INTO payment_applications (id, apply_amount, approved_amount, approved_amount_origin) VALUES (?, 100, ?, ?)', [id, value, origin])
      const draft = {
        amount: 30,
        paymentDate: '2026-09-11',
        payeeName: '收款方',
        voucherNo: `V-${id}`,
        bankSerialNo: `B-${id}`,
        confirmedBy: '经办人',
        applicationAllocations: [{ paymentApplicationId: id, allocatedAmount: 30 }],
      }
      if (id === 'zero') {
        await expect(store.saveForm('payment_record', draft, 'confirm')).rejects.toThrow('超过付款申请可付金额')
        continue
      }
      const saved = await store.saveForm('payment_record', draft, 'confirm')
      expect(await store.loadOne('payment_record', saved.id)).toMatchObject({ amount: 30, confirmationStatus: 'confirmed' })
      expect(await store.loadOne('payment_application', id)).toMatchObject({ approvedAmount: value, approvedAmountOrigin: origin, paidAmount: 30 })
      await expect(store.saveForm('payment_record', { ...draft, amount: 71, applicationAllocations: [{ paymentApplicationId: id, allocatedAmount: 71 }] }, 'confirm')).rejects.toThrow('超过付款申请可付金额')
    }
  })
  it('新申请未填批复保留 null，明确输入零存为零，并由保存域记录来源', async () => {
    const store = useFinanceStore()
    for (const approvedAmount of [undefined, null, 0, 80]) {
      const { id } = await store.saveForm('payment_application', {
        name: '批复来源',
        bizType: '公司付款',
        applyAmount: 100,
        approvedAmount,
      }, 'draft')
      expect(await store.loadOne('payment_application', id)).toMatchObject({
        approvedAmount: approvedAmount ?? null,
        approvedAmountOrigin: 'user-entry',
      })
      expect(await db.select('SELECT approved_amount, approved_amount_origin FROM payment_applications WHERE id = ?', [id])).toEqual([{
        approved_amount: approvedAmount ?? null,
        approved_amount_origin: 'user-entry',
      }])
    }
  })
})
