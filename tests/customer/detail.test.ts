import type { TestDb } from '../helpers/memory-db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCustomerDetail } from '~/lib/customer/detail'
import { runMigrations } from '~/lib/db/migrations'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb | null = null

async function createDb() {
  db = await createMemoryDb()
  await runMigrations(db)
  return db
}

async function seedCustomerFacts(mem: TestDb) {
  await mem.execute(`
    INSERT INTO customers (
      id, name, aliases, tax_no, legal_rep, registered_address,
      invoice_name, bank, bank_account, contact, contact_phone, status
    ) VALUES
      ('customer_1', '合和地产集团', '["合和地产"]', '91440101TEST',
       '何先生', '广州市天河区', '合和地产集团', '建设银行', '62270001',
       '林经理', '13800000001', 'active'),
      ('customer_2', '次客户', '[]', '', '', '', '', '', '', '', '', 'active')
  `)
  await mem.execute(`
    INSERT INTO projects (
      id, name, code, status, start_date, planned_end, manager,
      customer_id, secondary_customer_id
    ) VALUES
      ('project_1', '合和新城', 'HHXC-01', '施工中', '2026-01-01', '2026-12-31',
       '张经理', 'customer_1', NULL),
      ('project_2', '联合项目', 'LHXM-01', '筹备中', '', '', '',
       'customer_2', 'customer_1')
  `)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, customer_id, amount, changed,
      sign_date, status
    ) VALUES
      ('contract_1', 'RJ-HHXC-SG-001', '合和新城施工合同', '施工',
       'project_1', 'customer_1', 1000000, 50000, '2026-01-02', '履约中'),
      ('contract_draft', 'DRAFT-001', '草稿收入合同', '施工',
       'project_1', NULL, 200000, 0, '', '草稿'),
      ('contract_other', 'FB-001', '非收入分包合同', '分包',
       'project_1', 'customer_1', 300000, 0, '', '履约中')
  `)
  await mem.execute(`
    INSERT INTO contract_supplements (
      id, contract_id, no, name, amount, sign_date, status
    ) VALUES (
      'supplement_1', 'contract_1', 'BC-001', '有效补充协议',
      50000, '2026-02-01', '已签订'
    )
  `)
  await mem.execute(`
    INSERT INTO receipt_registrations (
      id, no, receipt_date, project_id, contract_id, customer_id,
      payer_account, amount, payment_method, status
    ) VALUES
      ('receipt_1', 'SK-001', '2026-05-01', 'project_1', 'contract_1',
       'customer_1', '合和地产集团', 320000, '银行转账', 'submitted'),
      ('receipt_draft', 'SK-DRAFT', '2026-05-02', 'project_1', 'contract_1',
       'customer_1', '合和地产集团', 80000, '银行转账', 'draft')
  `)
}

afterEach(() => {
  db?.close()
  db = null
})

describe('客户详情只读模型', () => {
  it('仅按真实外键汇总名下项目、施工合同和有效收款', async () => {
    const mem = await createDb()
    await seedCustomerFacts(mem)

    const detail = await loadCustomerDetail(mem, 'customer_1')

    expect(detail?.customer).toMatchObject({
      name: '合和地产集团',
      aliases: ['合和地产'],
      taxNo: '91440101TEST',
    })
    expect(detail?.projects).toEqual([
      expect.objectContaining({
        id: 'project_1',
        relationRole: '主客户',
        contractCount: 2,
        effectiveContractAmount: 1050000,
        effectiveReceiptAmount: 320000,
      }),
      expect.objectContaining({
        id: 'project_2',
        relationRole: '次客户',
        contractCount: 0,
        effectiveReceiptAmount: 0,
      }),
    ])
    expect(detail?.contracts.map(contract => contract.id)).toEqual([
      'contract_1',
      'contract_draft',
    ])
    expect(detail?.receipts.map(receipt => receipt.id)).toEqual([
      'receipt_draft',
      'receipt_1',
    ])
    expect(detail?.summary).toEqual({
      projectCount: 2,
      contractCount: 2,
      effectiveContractAmount: 1050000,
      receiptCount: 2,
      effectiveReceiptAmount: 320000,
      outstandingAmount: 730000,
      draftReceiptCount: 1,
    })
  })

  it('没有业务关系时返回明确空集合，不制造合同和收款', async () => {
    const mem = await createDb()
    await mem.execute(`
      INSERT INTO customers (id, name, aliases, status)
      VALUES ('customer_empty', '空白客户', '[]', 'active')
    `)

    const detail = await loadCustomerDetail(mem, 'customer_empty')

    expect(detail?.projects).toEqual([])
    expect(detail?.contracts).toEqual([])
    expect(detail?.receipts).toEqual([])
    expect(detail?.summary).toEqual({
      projectCount: 0,
      contractCount: 0,
      effectiveContractAmount: 0,
      receiptCount: 0,
      effectiveReceiptAmount: 0,
      outstandingAmount: 0,
      draftReceiptCount: 0,
    })
  })

  it('软删除客户返回不存在，软删除祖先项目后不再暴露合同和收款', async () => {
    const mem = await createDb()
    await seedCustomerFacts(mem)

    await mem.execute(`UPDATE projects SET deleted_at = '2026-07-29' WHERE id = 'project_1'`)
    const detail = await loadCustomerDetail(mem, 'customer_1')
    expect(detail?.projects.map(project => project.id)).toEqual(['project_2'])
    expect(detail?.contracts).toEqual([])
    expect(detail?.receipts).toEqual([])

    await mem.execute(`UPDATE customers SET deleted_at = '2026-07-29' WHERE id = 'customer_1'`)
    await expect(loadCustomerDetail(mem, 'customer_1')).resolves.toBeNull()
  })
})
