import type { TestDb } from '../helpers/memory-db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  confirmProjectSupplierSettlement,
  loadProjectSupplierWorkbench,
  projectSupplierWorkbenchTab,
} from '~/lib/project-supplier/workbench'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('project-1', '测试项目')`)
  await mem.execute(`
    INSERT INTO suppliers (id, name)
    VALUES ('supplier-1', '目标分供方'), ('supplier-2', '其他分供方')
  `)
  await mem.execute(`
    INSERT INTO project_suppliers (id, project_id, supplier_id, status)
    VALUES ('relation-1', 'project-1', 'supplier-1', 'paid')
  `)
})

describe('项目 × 分供方工作台读模型', () => {
  it('只接受六个可复用业务页签的 query 值', () => {
    expect(projectSupplierWorkbenchTab('payment')).toBe('payment')
    expect(projectSupplierWorkbenchTab('settlement')).toBe('settlement')
    expect(projectSupplierWorkbenchTab('unknown')).toBeNull()
    expect(projectSupplierWorkbenchTab(['payment'])).toBeNull()
  })

  it('合同额纳入有效补充，付款只计本关系的已确认申请分摊', async () => {
    await mem.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, supplier_id, amount, status
      )
      VALUES (
        'contract-1', 'FB-001', '专业分包合同', '分包',
        'project-1', 'supplier-1', 100, '履约中'
      )
    `)
    await mem.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, no, name, amount, status
      )
      VALUES
        ('supplement-formal', 'contract-1', 'BC-001', '正式补充', 20, '有效'),
        ('supplement-draft', 'contract-1', 'BC-002', '草稿补充', 60, 'draft')
    `)
    await mem.execute(`
      INSERT INTO payment_applications (
        id, no, name, project_id, supplier_id, contract_id,
        apply_amount, approved_amount, status
      )
      VALUES
        (
          'claim-target', 'FK-001', '目标请款', 'project-1', 'supplier-1',
          'contract-1', 40, 35, '已批复'
        ),
        (
          'claim-other', 'FK-002', '其他请款', 'project-1', 'supplier-2',
          'contract-1', 80, 70, 'approved'
        )
    `)
    await mem.execute(`
      INSERT INTO payment_records (
        id, no, project_id, supplier_id, payee_name, purpose, payment_date,
        amount, payment_method, voucher_no, bank_serial_no,
        confirmation_status, confirmed_by
      )
      VALUES (
        'payment-1', 'ZF-001', 'project-1', 'supplier-2', '混合支付',
        '两个申请合并支付', '2026-07-30', 100, '银行转账',
        'V-001', 'BANK-001', 'draft', '财务'
      )
    `)
    await mem.execute(`
      INSERT INTO payment_record_application_allocations (
        id, payment_record_id, payment_application_id, allocated_amount
      )
      VALUES
        ('allocation-target', 'payment-1', 'claim-target', 30),
        ('allocation-other', 'payment-1', 'claim-other', 70)
    `)
    await mem.execute(`
      UPDATE payment_records
      SET confirmation_status = 'confirmed',
          confirmed_at = '2026-07-30T08:00:00.000Z'
      WHERE id = 'payment-1'
    `)
    await mem.execute(`
      INSERT INTO invoices (
        id, file_name, project_id, supplier_id, invoice_number,
        total_amount, tax_amount, account_status
      )
      VALUES (
        'invoice-1', '目标发票.pdf', 'project-1', 'supplier-1', 'FP-001',
        22, 2, 'archived'
      )
    `)

    const result = await loadProjectSupplierWorkbench(
      mem,
      'project-1',
      'supplier-1',
      'relation-1',
    )

    expect(result.contracts).toEqual([
      expect.objectContaining({
        id: 'contract-1',
        amount: 100,
        changedAmount: 120,
      }),
    ])
    expect(result.claims).toEqual([
      expect.objectContaining({
        id: 'claim-target',
        approvedAmount: 35,
      }),
    ])
    expect(result.payments).toEqual([
      expect.objectContaining({
        id: 'payment-1',
        amount: 30,
        applicationNos: 'FK-001',
      }),
    ])
    expect(result.summary).toMatchObject({
      contractTotal: 120,
      claimedTotal: 35,
      invoiceTotal: 22,
      taxTotal: 2,
      paidTotal: 30,
      balance: 90,
    })
    expect(result.files).toContainEqual(expect.objectContaining({
      ownerType: 'invoice',
      ownerId: 'invoice-1',
      fileName: '目标发票.pdf',
      sourcePath: '/finance/invoice/invoice-1',
    }))
  })
})

describe('项目 × 分供方最终结算', () => {
  it('同一事务创建 1:1 结算、PDF 附件并进入合作终态', async () => {
    const result = await confirmProjectSupplierSettlement({
      projectSupplierId: 'relation-1',
      finalAmount: 128.5,
      date: '2026-07-30',
      note: '最终确认',
      pdf: {
        fileName: '结算确认书.pdf',
        fileSize: 3,
        mimeType: 'application/pdf',
        payloadBase64: 'UERG',
      },
    })

    const [settlement] = await mem.select<Record<string, unknown>>(
      'SELECT * FROM settlements WHERE id = ?',
      [result.settlementId],
    )
    const [file] = await mem.select<Record<string, unknown>>(
      'SELECT * FROM file_refs WHERE id = ?',
      [result.fileRefId],
    )
    const [relation] = await mem.select<{ status: string }>(
      'SELECT status FROM project_suppliers WHERE id = ?',
      ['relation-1'],
    )
    expect(settlement).toMatchObject({
      project_supplier_id: 'relation-1',
      final_amount: 128.5,
      pdf_file: result.fileRefId,
    })
    expect(file).toMatchObject({
      owner_type: 'settlement',
      owner_id: result.settlementId,
      file_name: '结算确认书.pdf',
    })
    expect(relation?.status).toBe('settled')

    await expect(confirmProjectSupplierSettlement({
      projectSupplierId: 'relation-1',
      finalAmount: 1,
      date: '2026-07-31',
      pdf: {
        fileName: '重复.pdf',
        mimeType: 'application/pdf',
      },
    })).rejects.toThrow('已结算')
  })

  it('缺少 PDF 或不在已付款状态时不写入任何记录', async () => {
    await expect(confirmProjectSupplierSettlement({
      projectSupplierId: 'relation-1',
      finalAmount: 100,
      date: '2026-07-30',
      pdf: {
        fileName: '错误格式.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    })).rejects.toThrow('必须上传 PDF')

    await mem.execute(`UPDATE project_suppliers SET status = 'claiming' WHERE id = 'relation-1'`)
    await expect(confirmProjectSupplierSettlement({
      projectSupplierId: 'relation-1',
      finalAmount: 100,
      date: '2026-07-30',
      pdf: {
        fileName: '结算确认书.pdf',
        mimeType: 'application/pdf',
      },
    })).rejects.toThrow('已付款')

    const [{ count }] = await mem.select<{ count: number }>(
      'SELECT COUNT(*) AS count FROM settlements',
    )
    expect(count).toBe(0)
  })

  it('接受扩展名明确但浏览器未提供 MIME 的 PDF', async () => {
    const result = await confirmProjectSupplierSettlement({
      projectSupplierId: 'relation-1',
      finalAmount: 100,
      date: '2026-07-30',
      pdf: {
        fileName: '结算确认书.PDF',
        mimeType: '',
      },
    })

    const [file] = await mem.select<Record<string, unknown>>(
      'SELECT file_name FROM file_refs WHERE id = ?',
      [result.fileRefId],
    )
    expect(file?.file_name).toBe('结算确认书.PDF')
  })
})
