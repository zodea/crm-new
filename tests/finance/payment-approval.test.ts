import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFinanceStore } from '~/stores/finance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

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
  db = await createMigratedMemoryDb()
  await db.execute('INSERT INTO suppliers(id,name) VALUES(\'supplier-payment-approval\',\'独立批复校验收款方\')')
  setActivePinia(createPinia())
})
afterEach(() => db.close())

describe('付款批复输入意图', () => {
  it.each(([-1, Number.NaN, Number.POSITIVE_INFINITY]).map(input => ({ input })))('保存域拒绝负数与非有限输入，失败后仍保留原金额与来源：输入案例 %#', async ({ input: value }) => {
    const store = useFinanceStore()
    const saved = await store.saveForm('payment_application', { name: '批复校验', bizType: '公司付款', applyAmount: 100 }, 'draft')
    const original = await store.loadOne('payment_application', saved.id)
    await expect(store.saveForm('payment_application', { ...original, approvedAmount: value, approvedAmountEdit: { value } }, 'draft')).rejects.toThrow('非负有效金额')
    expect(await store.loadOne('payment_application', saved.id)).toMatchObject({ approvedAmount: null, approvedAmountOrigin: 'user-entry' })
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

  it.each([
    { id: 'zero', value: 0, origin: 'user-entry', canPay: false },
    { id: 'empty', value: null, origin: 'user-entry', canPay: true },
    { id: 'legacy', value: 0, origin: 'legacy', canPay: false },
    { id: 'known', value: 80, origin: 'user-entry', canPay: true },
  ] as const)('批复 $id 的支付结果为 $canPay', async ({ id, value, origin, canPay }) => {
    const store = useFinanceStore()
    await db.execute('INSERT INTO payment_applications (id, supplier_id, apply_amount, approved_amount, approved_amount_origin) VALUES (?, \'supplier-payment-approval\', 100, ?, ?)', [id, value, origin])
    const draft = {
      supplierId: 'supplier-payment-approval',
      amount: 30,
      paymentDate: '2026-09-11',
      payeeName: '收款方',
      voucherNo: `V-${id}`,
      bankSerialNo: `B-${id}`,
      confirmedBy: '经办人',
      applicationAllocations: [{ paymentApplicationId: id, allocatedAmount: 30 }],
    }
    if (!canPay) {
      await expect(store.saveForm('payment_record', draft, 'confirm')).rejects.toThrow(id === 'legacy' ? '历史批复未知需先' : '超过付款申请可付金额')
      expect(await db.select('SELECT id FROM payment_records')).toEqual([])
      expect(await store.loadOne('payment_application', id)).toMatchObject({ approvedAmount: value, approvedAmountOrigin: origin, paidAmount: 0 })
      if (id === 'legacy') {
        const saved = await store.saveForm('payment_record', draft, 'draft')
        expect(await store.loadOne('payment_record', saved.id)).toMatchObject({ amount: 30, confirmationStatus: 'draft' })
      }
      return
    }
    const saved = await store.saveForm('payment_record', draft, 'confirm')
    expect(await store.loadOne('payment_record', saved.id)).toMatchObject({ amount: 30, confirmationStatus: 'confirmed' })
    expect(await store.loadOne('payment_application', id)).toMatchObject({ approvedAmount: value, approvedAmountOrigin: origin, paidAmount: 30 })
    await expect(store.saveForm('payment_record', { ...draft, amount: 71, applicationAllocations: [{ paymentApplicationId: id, allocatedAmount: 71 }] }, 'confirm')).rejects.toThrow('超过付款申请可付金额')
  })
  it.each([null, 0, 80])('原历史未知改成明确输入 %s 也不能跳过真实业务核验，回单原件草稿仍保留', async (value) => {
    const store = useFinanceStore()
    await db.execute('INSERT INTO payment_applications(id,supplier_id,apply_amount,approved_amount,approved_amount_origin) VALUES(\'legacy-edit-proof\',\'supplier-payment-approval\',100,0,\'legacy\')')
    const original = await store.loadOne('payment_application', 'legacy-edit-proof')
    await store.saveForm('payment_application', { ...original, approvedAmount: value, approvedAmountEdit: { value } }, 'draft')
    expect(await store.loadOne('payment_application', 'legacy-edit-proof')).toMatchObject({ approvedAmount: value, approvedAmountOrigin: 'user-entry', paymentVerification: { required: true } })
    const payment = { supplierId: 'supplier-payment-approval', amount: 30, paymentDate: '2026-10-05', payeeName: '实际收款方', voucherNo: 'LEGACY-DRAFT', bankSerialNo: 'LEGACY-DRAFT', confirmedBy: '输入姓名不能替代可信核验', applicationAllocations: [{ paymentApplicationId: 'legacy-edit-proof', allocatedAmount: 30 }] }
    const saved = await store.saveForm('payment_record', payment, 'draft', { add: [{ fileName: '真实回单.bin', fileSize: 4, mimeType: 'application/octet-stream', payloadBase64: 'AAqA/w==' }] })
    await expect(store.saveForm('payment_record', { ...payment, id: saved.id }, 'confirm')).rejects.toThrow('历史批复未知需先')
    expect(await store.loadOne('payment_record', saved.id)).toMatchObject({ amount: 30, confirmationStatus: 'draft' })
    expect(await db.select('SELECT allocated_amount FROM payment_record_application_allocations WHERE payment_record_id=?', [saved.id])).toEqual([{ allocated_amount: 30 }])
    expect(await db.select('SELECT content FROM file_payloads WHERE file_ref_id=?', [saved.attachmentIds[0]])).toEqual([{ content: 'AAqA/w==' }])
    expect(await db.select('SELECT id FROM payment_records WHERE confirmation_status=\'confirmed\'')).toEqual([])
  })
  it.each([
    { approvedAmount: undefined, expectedAmount: null },
    { approvedAmount: null, expectedAmount: null },
    { approvedAmount: 0, expectedAmount: 0 },
    { approvedAmount: 80, expectedAmount: 80 },
  ])('新申请批复 $approvedAmount 读回为 $expectedAmount', async ({ approvedAmount, expectedAmount }) => {
    const store = useFinanceStore()
    const { id } = await store.saveForm('payment_application', {
      name: '批复来源',
      bizType: '公司付款',
      applyAmount: 100,
      approvedAmount,
    }, 'draft')
    expect(await store.loadOne('payment_application', id)).toMatchObject({
      approvedAmount: expectedAmount,
      approvedAmountOrigin: 'user-entry',
    })
    expect(await db.select('SELECT approved_amount, approved_amount_origin FROM payment_applications WHERE id = ?', [id])).toEqual([{
      approved_amount: expectedAmount,
      approved_amount_origin: 'user-entry',
    }])
  })
})
