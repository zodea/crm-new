import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  contractStages,
  loadContractDetailSnapshot,
} from '~/lib/contract/detail'
import { runMigrations } from '~/lib/db/migrations'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO customers (id, name) VALUES ('customer-a', '甲方客户')`)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('project-a', '演示项目', 'customer-a')
  `)
  await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-a', '材料分供方')`)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, customer_id, supplier_id, status
    )
    VALUES
      (
        'contract-construction', 'SG-001', '施工合同', '施工',
        'project-a', 'customer-a', NULL, '履约中'
      ),
      (
        'contract-material', 'CG-001', '材料合同', '材采',
        'project-a', NULL, 'supplier-a', '已签订'
      )
  `)
})

afterEach(() => {
  mem.close()
})

describe('contract detail read model', () => {
  it('按施工合同真实外键聚合补充协议、变洽签、报量、开票、收款和文件', async () => {
    await mem.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, no, name, amount, sign_date, status
      )
      VALUES (
        'supplement-a', 'contract-construction', 'BC-001',
        '调价补充协议', 120, '2026-06-01', '有效'
      )
    `)
    await mem.execute(`
      INSERT INTO owner_change_orders (
        id, project_id, contract_id, change_no, name,
        tax_inc_amount, approval_date, status, source_type, source_id
      )
      VALUES (
        'owner-change-a', 'project-a', 'contract-construction',
        'BG-001', '现场签证', 80, '2026-06-02', 'approved',
        'boq_change_order', 'boq-change-a'
      )
    `)
    await mem.execute(`
      INSERT INTO monthly_statements (
        id, project_id, contract_id, month, no, total_amount, status
      )
      VALUES (
        'report-a', 'project-a', 'contract-construction',
        '2026-06', 'BL-001', 300, 'adjusted'
      )
    `)
    await mem.execute(`
      INSERT INTO invoice_applications (
        id, project_id, contract_id, customer_id, no, name,
        amount, application_date, status
      )
      VALUES (
        'billing-a', 'project-a', 'contract-construction', 'customer-a',
        'KP-001', '进度款开票', 280, '2026-06-03', 'submitted'
      )
    `)
    await mem.execute(`
      INSERT INTO receipt_registrations (
        id, project_id, contract_id, customer_id, no,
        amount, receipt_date, status
      )
      VALUES (
        'receipt-a', 'project-a', 'contract-construction', 'customer-a',
        'SK-001', 260, '2026-06-04', 'submitted'
      )
    `)
    await mem.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, file_size, category
      )
      VALUES (
        'file-a', 'contract', 'contract-construction',
        '施工合同扫描件.pdf', 2048, '正式合同'
      )
    `)

    const detail = await loadContractDetailSnapshot('contract-construction', '施工')

    expect(detail.documents.map(row => [row.group, row.no, row.to])).toEqual([
      ['补充协议', 'BC-001', ''],
      ['甲方变洽签', 'BG-001', '/owner/change/boq-change-a'],
      ['甲方报量', 'BL-001', '/owner/report/report-a'],
      ['开票申请', 'KP-001', '/finance/billing/billing-a'],
      ['收款登记', 'SK-001', '/finance/receipt/receipt-a'],
    ])
    expect(detail.lineItems).toEqual([])
    expect(detail.files).toEqual([
      expect.objectContaining({
        id: 'file-a',
        fileName: '施工合同扫描件.pdf',
        category: '正式合同',
      }),
    ])
  })

  it('材料合同保留真实采购明细和材料单据，不生成变洽签', async () => {
    await mem.execute(`
      INSERT INTO contract_line_items (
        id, contract_id, material_name, spec, brand, unit,
        qty, tax_inclusive_unit_price, planned_arrival_date
      )
      VALUES (
        'line-a', 'contract-material', '墙砖', '600×600', '示例品牌',
        '㎡', 10, 25.5, '2026-07-01'
      )
    `)
    await mem.execute(`
      INSERT INTO material_requisitions (
        id, no, project_id, contract_id, material_name,
        requisition_date, status
      )
      VALUES (
        'requisition-a', 'XQ-001', 'project-a', 'contract-material',
        '墙砖', '2026-06-10', 'submitted'
      )
    `)
    await mem.execute(`
      INSERT INTO material_arrivals (
        id, no, project_id, supplier_id, contract_id,
        warehouse, arrival_date, status
      )
      VALUES (
        'arrival-a', 'DH-001', 'project-a', 'supplier-a',
        'contract-material', '项目仓', '2026-06-12', 'submitted'
      )
    `)

    const detail = await loadContractDetailSnapshot('contract-material', '材采')

    expect(detail.documents.map(row => row.group)).toEqual(['材料申请', '材料到货'])
    expect(detail.documents.map(row => row.to)).toEqual([
      '/material/requisition/requisition-a',
      '/material/arrival/arrival-a',
    ])
    expect(detail.lineItems).toEqual([
      expect.objectContaining({
        materialName: '墙砖',
        qty: 10,
        unitPrice: 25.5,
        amount: 255,
      }),
    ])
  })

  it('合同阶段只按当前业务状态标记完成、当前与待办', () => {
    expect(contractStages('已结算').map(stage => stage.state)).toEqual([
      'complete',
      'complete',
      'complete',
      'current',
      'pending',
    ])
  })
})
