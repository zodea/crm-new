import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteF2Form,
  listContractFormAttachments,
  listExpenditureSettlementOptions,
  loadContractSupplementForm,
  loadF2Form,
} from '~/lib/contract/forms'
import { runMigrations } from '~/lib/db/migrations'
import { useContractStore } from '~/stores/contract'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failFileInsert = false

vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
  withTransaction: async <T>(
    work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>,
  ) => {
    await mem.execute('BEGIN')
    try {
      const result = await work({
        execute: (sql, params) => {
          if (failFileInsert && /INSERT INTO file_refs/i.test(sql))
            throw new Error('模拟附件写入失败')
          return mem.execute(sql, params)
        },
        select: (sql, params) => mem.select(sql, params),
      })
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
  failFileInsert = false
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())
  await mem.execute(`
    INSERT INTO customers (id, name, status)
    VALUES ('customer-contract', '合同甲方', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, approval_status)
    VALUES ('project-contract', '合同项目', 'customer-contract', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name, approval_status)
    VALUES ('supplier-contract', '合同分供方', 'approved')
  `)
})

afterEach(() => {
  mem.close()
})

describe('f2 合同与支出结算领域 action', () => {
  it('六条表单经同一 Pinia store 保存真实 ID，并写入各自 canonical 实体', async () => {
    const store = useContractStore()
    const construction = await store.saveForm('construction', {
      no: 'CON-STORE',
      name: '施工主合同',
      projectId: 'project-contract',
      customerId: 'customer-contract',
      content: '施工总承包',
      signDate: '2026-07-01',
      amount: 1000,
    }, 'submit')
    const subcontract = await store.saveForm('subcontract', {
      no: 'SUB-STORE',
      name: '劳务分包合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      subKind: '劳务',
      content: '泥水劳务',
      signDate: '2026-07-02',
      amount: 200,
    }, 'submit')
    const material = await store.saveForm('material', {
      no: 'MAT-STORE',
      name: '材料采购合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '瓷砖采购',
      signDate: '2026-07-03',
      amount: 238,
      lineItems: [{
        materialName: '瓷砖',
        spec: '600×600',
        brand: '示例品牌',
        unit: '㎡',
        qty: 10,
        taxInclusiveUnitPrice: 23.8,
        plannedArrivalDate: '2026-07-20',
        note: '',
      }],
    }, 'submit')
    const otherExpense = await store.saveForm('other_expense', {
      no: 'OTHER-STORE',
      name: '机械租赁合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      otherExpenseKind: '机械租赁',
      content: '升降机租赁',
      signDate: '2026-07-04',
      amount: 300,
      paymentCycle: '月',
    }, 'submit')
    const companyExpense = await store.saveForm('company_expense', {
      no: 'COMPANY-STORE',
      name: '办公软件合同',
      category: '软件',
      counterparty: '软件服务商',
      signDate: '2026-07-05',
      amount: 99,
      paymentCycle: '年',
    }, 'submit')
    const settlement = await store.saveForm('other_settlement', {
      no: 'SETTLE-STORE',
      name: '机械租赁结算',
      projectId: 'project-contract',
      contractId: otherExpense.id,
      totalAmount: 120,
      settlementDate: '2026-07-25',
    }, 'submit')

    expect(store.byId(construction.id)).toMatchObject({
      customerId: 'customer-contract',
      projectId: 'project-contract',
      kind: '施工',
      status: '审批中',
      changed: 1000,
    })
    expect(store.byId(subcontract.id)).toMatchObject({
      supplierId: 'supplier-contract',
      kind: '分包',
      subKind: '劳务',
    })
    expect(store.byId(material.id)?.kind).toBe('材采')
    expect(await mem.select(`
      SELECT contract_id, material_name, qty, tax_inclusive_unit_price
      FROM contract_line_items
      WHERE contract_id = ?
    `, [material.id])).toEqual([{
      contract_id: material.id,
      material_name: '瓷砖',
      qty: 10,
      tax_inclusive_unit_price: 23.8,
    }])
    expect(await mem.select(`
      SELECT id, name FROM company_expense_contracts WHERE id = ?
    `, [companyExpense.id])).toEqual([{
      id: companyExpense.id,
      name: '办公软件合同',
    }])
    expect(await mem.select(`
      SELECT id, biz_type, project_id, supplier_id, contract_id, status
      FROM expenditure_settlements
      WHERE id = ?
    `, [settlement.id])).toEqual([{
      id: settlement.id,
      biz_type: '机械',
      project_id: 'project-contract',
      supplier_id: 'supplier-contract',
      contract_id: otherExpense.id,
      status: '审批中',
    }])
    expect(await loadF2Form('other_settlement', settlement.id))
      .toMatchObject({ id: settlement.id, contractId: otherExpense.id })
  })

  it('补充协议只写 contract_supplements，头、附件与操作日志同事务保存', async () => {
    const store = useContractStore()
    const original = await store.saveForm('construction', {
      no: 'CON-ORIGINAL',
      name: '原施工合同',
      projectId: 'project-contract',
      customerId: 'customer-contract',
      content: '原合同内容',
      signDate: '2026-06-01',
      amount: 1000,
    }, 'submit')
    const before = store.list.length

    const supplement = await store.saveForm('construction', {
      isSupplement: true,
      originalContractId: original.id,
      no: 'SUP-001',
      name: '增补工程协议',
      content: '增加工程范围',
      signDate: '2026-07-10',
      amount: 88,
    }, 'submit', {
      add: [{
        fileName: '补充协议.pdf',
        filePath: 'C:\\contracts\\补充协议.pdf',
        fileSize: 1024,
        category: '正式合同扫描件',
      }],
    })

    expect(store.list).toHaveLength(before)
    expect(store.byId(original.id)?.changed).toBe(1088)
    expect(await mem.select(`
      SELECT id, contract_id, name, amount
      FROM contract_supplements
      WHERE id = ?
    `, [supplement.id])).toEqual([{
      id: supplement.id,
      contract_id: original.id,
      name: '增补工程协议',
      amount: 88,
    }])
    expect(await listContractFormAttachments('contract_supplement', supplement.id))
      .toEqual([expect.objectContaining({
        fileName: '补充协议.pdf',
        filePath: 'C:\\contracts\\补充协议.pdf',
      })])
    expect(await mem.select(`
      SELECT table_name, record_id, action
      FROM operation_logs
      WHERE record_id = ?
      ORDER BY rowid
    `, [supplement.id])).toEqual([{
      table_name: 'contract_supplements',
      record_id: supplement.id,
      action: 'create',
    }])

    await store.saveForm('construction', {
      id: supplement.id,
      isSupplement: true,
      originalContractId: original.id,
      no: 'SUP-001',
      name: '增补工程协议（修订）',
      content: '增加工程范围并调整金额',
      signDate: '2026-07-11',
      amount: 90,
      status: '审批中',
    }, 'save', {
      removeIds: supplement.attachmentIds,
    })
    expect(await loadContractSupplementForm(supplement.id)).toMatchObject({
      id: supplement.id,
      isSupplement: true,
      originalContractId: original.id,
      name: '增补工程协议（修订）',
      amount: 90,
    })
    expect(await mem.select(`
      SELECT COUNT(*) AS total
      FROM contract_supplements
      WHERE id = ?
    `, [supplement.id])).toEqual([{ total: 1 }])
    expect(await listContractFormAttachments('contract_supplement', supplement.id, true))
      .toEqual([expect.objectContaining({ deletedAt: expect.any(String) })])

    await store.saveForm('construction', {
      id: supplement.id,
      isSupplement: true,
      originalContractId: original.id,
      no: 'SUP-001',
      name: '增补工程协议（修订）',
      content: '增加工程范围并调整金额',
      signDate: '2026-07-11',
      amount: 90,
      status: '审批中',
    }, 'save', {
      restoreIds: supplement.attachmentIds,
    })
    expect(await listContractFormAttachments('contract_supplement', supplement.id))
      .toHaveLength(1)
  })

  it('编辑材采、公司支出和结算后刷新完整回显，材采行支持删旧增新', async () => {
    const store = useContractStore()
    const material = await store.saveForm('material', {
      name: '原材料合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '原内容',
      signDate: '2026-07-01',
      amount: 20,
      lineItems: [{
        materialName: '旧材料',
        qty: 2,
        taxInclusiveUnitPrice: 10,
      }],
    }, 'submit')
    await store.saveForm('material', {
      id: material.id,
      no: 'MAT-UPDATED',
      name: '更新材料合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '更新内容',
      signDate: '2026-07-02',
      amount: 45,
      lineItems: [{
        materialName: '新材料',
        spec: 'A1',
        brand: '品牌',
        unit: '套',
        qty: 3,
        taxInclusiveUnitPrice: 15,
        plannedArrivalDate: '2026-08-01',
      }],
    }, 'submit')
    expect(await loadF2Form('material', material.id)).toMatchObject({
      id: material.id,
      no: 'MAT-UPDATED',
      name: '更新材料合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      amount: 45,
      lineItems: [{
        materialName: '新材料',
        spec: 'A1',
        qty: 3,
        taxInclusiveUnitPrice: 15,
      }],
    })
    expect(store.byId(material.id)?.changed).toBe(45)
    expect(await mem.select(`
      SELECT material_name
      FROM contract_line_items
      WHERE contract_id = ? AND deleted_at IS NULL
    `, [material.id])).toEqual([{ material_name: '新材料' }])

    const company = await store.saveForm('company_expense', {
      name: '公司支出原稿',
      counterparty: '服务商',
      signDate: '2026-07-01',
      amount: 10,
    }, 'submit')
    await store.saveForm('company_expense', {
      id: company.id,
      no: 'COMPANY-UPDATED',
      name: '公司支出更新',
      category: '软件',
      counterparty: '新服务商',
      signDate: '2026-07-02',
      servicePeriod: '一年',
      amount: 12,
      paymentCycle: '年付',
      mainTerms: '按年续费',
      note: '刷新保留',
    }, 'save')
    expect(await loadF2Form('company_expense', company.id)).toMatchObject({
      no: 'COMPANY-UPDATED',
      name: '公司支出更新',
      counterparty: '新服务商',
      amount: 12,
      note: '刷新保留',
    })

    const other = await store.saveForm('other_expense', {
      name: '结算源合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '服务',
      signDate: '2026-07-01',
      amount: 100,
    }, 'submit')
    const settlement = await store.saveForm('other_settlement', {
      name: '原结算',
      projectId: 'project-contract',
      contractId: other.id,
      totalAmount: 30,
      settlementDate: '2026-07-10',
    }, 'submit')
    await store.saveForm('other_settlement', {
      id: settlement.id,
      no: 'SETTLE-UPDATED',
      name: '更新结算',
      projectId: 'project-contract',
      contractId: other.id,
      totalAmount: 35,
      settlementDate: '2026-07-11',
      settlementPeriod: '2026-07',
      deductionNote: '无扣减',
      note: '刷新保留',
    }, 'save')
    expect(await loadF2Form('other_settlement', settlement.id)).toMatchObject({
      no: 'SETTLE-UPDATED',
      name: '更新结算',
      projectId: 'project-contract',
      contractId: other.id,
      totalAmount: 35,
      settlementPeriod: '2026-07',
      note: '刷新保留',
    })
  })

  it('草稿允许不完整并可刷新回显；提交拒绝假 ID、关系错配、负数和材采勾稽差额', async () => {
    const store = useContractStore()
    const draft = await store.saveForm('material', {
      name: '',
      amount: 0,
    }, 'draft')
    expect(await loadF2Form('material', draft.id)).toMatchObject({
      id: draft.id,
      status: '草稿',
      projectId: null,
      supplierId: null,
    })
    const incompleteLineDraft = await store.saveForm('material', {
      name: '明细未填完的草稿',
      lineItems: [{
        materialName: '',
        qty: null,
        taxInclusiveUnitPrice: null,
      }],
    }, 'draft')
    expect(await loadF2Form('material', incompleteLineDraft.id)).toMatchObject({
      id: incompleteLineDraft.id,
      status: '草稿',
      lineItems: [{
        materialName: '',
        qty: null,
        taxInclusiveUnitPrice: null,
      }],
    })

    await expect(store.saveForm('construction', {
      name: '假关系合同',
      projectId: 'project-contract',
      customerId: 'missing-customer',
      content: '内容',
      signDate: '2026-07-01',
      amount: 1,
    }, 'submit')).rejects.toThrow('甲方客户不存在或已删除')
    await expect(store.saveForm('other_expense', {
      name: '假分供方合同',
      projectId: 'project-contract',
      supplierId: 'missing-supplier',
      content: '内容',
      signDate: '2026-07-01',
      amount: 1,
    }, 'submit')).rejects.toThrow('分供方不存在或已删除')
    await expect(store.saveForm('company_expense', {
      name: '负数公司支出',
      counterparty: '对方单位',
      signDate: '2026-07-01',
      amount: -1,
    }, 'submit')).rejects.toThrow('合同金额不能为负数')
    await expect(store.saveForm('material', {
      name: '金额不平材料合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '内容',
      signDate: '2026-07-01',
      amount: 100,
      lineItems: [{
        materialName: '瓷砖',
        qty: 2,
        taxInclusiveUnitPrice: 30,
      }],
    }, 'submit')).rejects.toThrow('材采明细含税汇总与合同头金额不一致')
  })

  it('附件失败回滚头表、明细和操作日志，结算 lookup 只返回真实可选源单', async () => {
    const store = useContractStore()
    failFileInsert = true
    await expect(store.saveForm('material', {
      no: 'MAT-ROLLBACK',
      name: '事务回滚材料合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '内容',
      signDate: '2026-07-01',
      amount: 60,
      lineItems: [{
        materialName: '瓷砖',
        qty: 2,
        taxInclusiveUnitPrice: 30,
      }],
    }, 'submit', {
      add: [{ fileName: '合同.pdf' }],
    })).rejects.toThrow('模拟附件写入失败')
    expect(await mem.select(`
      SELECT COUNT(*) AS total FROM contracts WHERE no = 'MAT-ROLLBACK'
    `)).toEqual([{ total: 0 }])
    expect(await mem.select(`
      SELECT COUNT(*) AS total
      FROM contract_line_items
      WHERE material_name = '瓷砖'
    `)).toEqual([{ total: 0 }])

    failFileInsert = false
    const other = await store.saveForm('other_expense', {
      name: '可结算合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      otherExpenseKind: '其他',
      content: '服务',
      signDate: '2026-07-01',
      amount: 100,
    }, 'submit')
    const settlement = await store.saveForm('other_settlement', {
      name: '可选结算',
      projectId: 'project-contract',
      contractId: other.id,
      totalAmount: 80,
      settlementDate: '2026-07-20',
    }, 'submit')
    await store.saveForm('other_settlement', {
      name: '',
    }, 'draft')

    expect(await listExpenditureSettlementOptions({
      projectId: 'project-contract',
      contractId: other.id,
    })).toEqual([{
      id: settlement.id,
      label: '可选结算',
      hint: '80.00',
    }])
  })

  it('合同存在有效结算时阻止删除，结算软删除后才允许删除合同', async () => {
    const store = useContractStore()
    const contract = await store.saveForm('other_expense', {
      name: '有结算引用合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '服务',
      signDate: '2026-07-01',
      amount: 100,
    }, 'submit')
    const settlement = await store.saveForm('other_settlement', {
      name: '引用合同的结算',
      projectId: 'project-contract',
      contractId: contract.id,
      totalAmount: 80,
      settlementDate: '2026-07-20',
    }, 'submit')

    await expect(deleteF2Form('other_expense', contract.id))
      .rejects
      .toThrow('有效结算')

    const settlementLogId = await deleteF2Form('other_settlement', settlement.id)
    expect(settlementLogId).toBeTruthy()
    expect(await mem.select(`
      SELECT deleted_at IS NOT NULL AS deleted
      FROM expenditure_settlements
      WHERE id = ?
    `, [settlement.id])).toEqual([{ deleted: 1 }])

    const contractLogId = await deleteF2Form('other_expense', contract.id)
    expect(contractLogId).toBeTruthy()
  })

  it('编辑态锁定合同类型与主从身份，错误路由不能改写既有实体', async () => {
    const store = useContractStore()
    const contract = await store.saveForm('construction', {
      name: '类型锁定合同',
      projectId: 'project-contract',
      customerId: 'customer-contract',
    }, 'draft')

    expect(await loadF2Form('material', contract.id)).toBeNull()
    await expect(store.saveForm('material', {
      id: contract.id,
      name: '越权改类型',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
    }, 'draft')).rejects.toThrow('合同类型与当前编辑入口不一致')
    await expect(store.saveForm('construction', {
      id: contract.id,
      isSupplement: true,
      originalContractId: contract.id,
      name: '越权改身份',
    }, 'draft')).rejects.toThrow('主合同不能改为补充协议')
  })
})
