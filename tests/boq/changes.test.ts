import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  approveBoqChangeOrder,
  createBoqChangeOrder,
  reviseApprovedBoqChangeOrder,
  transitionBoqChangeOrder,
} from '~/lib/boq/change'
import { loadBoqWorkspace } from '~/lib/boq/read-model'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await seedIfEmpty(db)
})

afterEach(() => db.close())

describe('boq change order lifecycle', () => {
  it('approves a price change into immutable owner ledger and effective contract price', async () => {
    const created = await createBoqChangeOrder(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      code: 'BG-2026-002',
      name: '地砖合同单价调整',
      changeType: 'price',
      directiveNo: 'ZL-2026-020',
      directiveType: 'changed',
      lines: [{
        operation: 'price',
        boqLineId: 'boq_line_demo_a_floor',
        newUnitPrice: 90,
        note: '甲方确认单价',
      }],
    })
    await transitionBoqChangeOrder(db, created.orderId, 'submitted', '已提交甲方')
    const approved = await approveBoqChangeOrder(db, created.orderId, '2026-07-20')

    expect(approved.totalAmount).toBe(310)
    const [ledger] = await db.select<{
      source_type: string
      source_id: string
      source_locked: number
      tax_inc_amount: number
    }>('SELECT source_type, source_id, source_locked, tax_inc_amount FROM owner_change_orders WHERE id = ?', [approved.ledgerId])
    expect(ledger).toEqual({
      source_type: 'boq_change_order',
      source_id: created.orderId,
      source_locked: 1,
      tax_inc_amount: 310,
    })

    const workspace = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    expect(workspace.lines.find(line => line.id === 'boq_line_demo_a_floor')).toMatchObject({
      effectiveQty: 31,
      effectiveUnitPrice: 90,
      effectiveAmount: 2790,
      approvedChangeAmount: 310,
    })
    await expect(transitionBoqChangeOrder(db, created.orderId, 'rejected', '不可逆')).rejects.toThrow('已签证')
  })

  it('materializes an approved added item as a traceable boq line', async () => {
    const created = await createBoqChangeOrder(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      code: 'BG-2026-003',
      name: '新增门槛石',
      changeType: 'add',
      lines: [{
        operation: 'add',
        itemId: 'qty_item_masonry_floor',
        section: '装饰装修',
        trade: '泥水工',
        itemName: '门槛石铺贴',
        unit: 'm',
        qty: 12,
        newUnitPrice: 75,
        spec: '20mm 厚石材',
      }],
    })
    await transitionBoqChangeOrder(db, created.orderId, 'submitted')
    await approveBoqChangeOrder(db, created.orderId, '2026-07-21')

    const [changeLine] = await db.select<{ result_boq_line_id: string }>(
      'SELECT result_boq_line_id FROM boq_change_lines WHERE change_order_id = ?',
      [created.orderId],
    )
    const [result] = await db.select<{
      boq_file_id: null
      change_order_id: string
      item_id: string
      section: string
      trade: string
      item_name: string
      qty: number
      unit_price: number
      amount: number
    }>('SELECT boq_file_id, change_order_id, item_id, section, trade, item_name, qty, unit_price, amount FROM boq_lines WHERE id = ?', [changeLine?.result_boq_line_id])
    expect(result).toEqual({
      boq_file_id: null,
      change_order_id: created.orderId,
      item_id: 'qty_item_masonry_floor',
      section: '装饰装修',
      trade: '泥水工',
      item_name: '门槛石铺贴',
      qty: 12,
      unit_price: 75,
      amount: 900,
    })
  })

  it('revises a single approved quantity change only after confirmation and keeps ledger reconciled', async () => {
    const created = await createBoqChangeOrder(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      code: 'BG-2026-007',
      name: '地砖工程量签证',
      changeType: 'qty',
      lines: [{
        operation: 'qty',
        boqLineId: 'boq_line_demo_a_floor',
        deltaQty: 2,
      }],
    })
    await transitionBoqChangeOrder(db, created.orderId, 'submitted')
    const approved = await approveBoqChangeOrder(db, created.orderId, '2026-07-22')
    const workspace = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    const change = workspace?.changes.find(order => order.id === created.orderId)
    expect(change?.lines).toHaveLength(1)

    const correction = {
      name: '地砖工程量签证（更正）',
      line: {
        id: change!.lines[0]!.id,
        deltaQty: 3,
        note: '甲方复核后更正',
      },
    }
    await expect(reviseApprovedBoqChangeOrder(db, created.orderId, correction, false))
      .rejects
      .toThrow('二次确认')

    const result = await reviseApprovedBoqChangeOrder(db, created.orderId, correction, true)
    expect(result.totalAmount).toBe(240)
    expect(result.logIds.length).toBeGreaterThanOrEqual(3)
    const [ledger] = await db.select<{ tax_inc_amount: number }>(
      'SELECT tax_inc_amount FROM owner_change_orders WHERE id = ?',
      [approved.ledgerId],
    )
    expect(ledger?.tax_inc_amount).toBe(240)

    const corrected = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    expect(corrected?.lines.find(line => line.id === 'boq_line_demo_a_floor')).toMatchObject({
      effectiveQty: 34,
      approvedChangeAmount: 240,
    })
    expect(corrected?.changes.find(order => order.id === created.orderId)).toMatchObject({
      name: '地砖工程量签证（更正）',
      totalAmount: 240,
      statusNote: '甲方已签证 · 二次确认更正',
    })
  })

  it('calculates mixed changes on one line sequentially and keeps ledger total reconcilable', async () => {
    const created = await createBoqChangeOrder(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      code: 'BG-2026-005',
      name: '地砖量价同步调整',
      changeType: 'mixed',
      lines: [
        {
          operation: 'qty',
          boqLineId: 'boq_line_demo_a_floor',
          deltaQty: 2,
        },
        {
          operation: 'price',
          boqLineId: 'boq_line_demo_a_floor',
          newUnitPrice: 100,
        },
      ],
    })
    await transitionBoqChangeOrder(db, created.orderId, 'submitted')
    const approved = await approveBoqChangeOrder(db, created.orderId, '2026-07-22')

    expect(approved.totalAmount).toBe(820)
    const workspace = await loadBoqWorkspace(db, 'proj_demo_001', 'con_demo_sg01')
    expect(workspace.lines.find(line => line.id === 'boq_line_demo_a_floor')).toMatchObject({
      effectiveQty: 33,
      effectiveUnitPrice: 100,
      effectiveAmount: 3300,
      approvedChangeAmount: 820,
    })
  })

  it('rejects cumulative quantity reductions below zero within one draft', async () => {
    await expect(createBoqChangeOrder(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      code: 'BG-2026-006',
      name: '无效累计减量',
      changeType: 'qty',
      lines: [
        { operation: 'qty', boqLineId: 'boq_line_demo_a_floor', deltaQty: -20 },
        { operation: 'qty', boqLineId: 'boq_line_demo_a_floor', deltaQty: -20 },
      ],
    })).rejects.toThrow('不能为负数')
  })

  it('enforces the submitted/rejected resubmission state machine', async () => {
    const created = await createBoqChangeOrder(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      code: 'BG-2026-004',
      name: '待退回变更',
      changeType: 'qty',
      lines: [{
        operation: 'qty',
        boqLineId: 'boq_line_demo_b_floor',
        deltaQty: 1,
      }],
    })
    await expect(transitionBoqChangeOrder(db, created.orderId, 'approved')).rejects.toThrow('已上报')
    await transitionBoqChangeOrder(db, created.orderId, 'submitted')
    await transitionBoqChangeOrder(db, created.orderId, 'rejected', '资料不齐')
    await transitionBoqChangeOrder(db, created.orderId, 'submitted', '已补资料')

    const [row] = await db.select<{ status: string, status_note: string }>(
      'SELECT status, status_note FROM boq_change_orders WHERE id = ?',
      [created.orderId],
    )
    expect(row).toEqual({ status: 'submitted', status_note: '已补资料' })
  })
})
