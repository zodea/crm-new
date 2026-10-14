import type { TestDb } from '../helpers/memory-db'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readNativeConstructionManagementFee } from '~/lib/construction-contract/management-fee-storage'
import {
  deleteF2Form,
  listContractFormAttachments,
  listExpenditureSettlementOptions,
  loadContractSupplementForm,
  loadF2Form,
} from '~/lib/contract/forms'
import { loadFileRefContent } from '~/lib/forms/file-refs'
import { useContractStore } from '~/stores/contract'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failFileInsert = false
const OUR_SELECTED = { ourSignatoryId: 'our-contract', ourSignatoryVersion: '1' }

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
  mem = await createMigratedMemoryDb()
  const ownFacts = JSON.stringify({ name: '合同我方实际公司', taxNo: 'TEST-TAX', registeredAddress: null, legalRepresentative: null, verificationNote: '本测试独立核实主体事实', status: 'active' })
  await mem.execute('INSERT INTO our_signatories VALUES(?,?,?,?,?)', ['our-contract', ownFacts, 1, '2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z'])
  await mem.execute('INSERT INTO our_signatory_history VALUES(?,?,?,?,?,?,?)', ['our-contract-v1', 'our-contract', 1, ownFacts, null, null, '2026-10-04T00:00:00.000Z'])
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
  it('总合同配置空与零读回、编辑撤销保留冻结历史，附件失败同事务回滚且供应商合同拒绝配置', async () => {
    const store = useContractStore()
    const base = { ...OUR_SELECTED, name: '管理费配置总合同', projectId: 'project-contract', customerId: 'customer-contract', content: '施工', signDate: '2026-10-05', amount: 5000 }
    const first = await store.saveForm('construction', { ...base, managementFeeAmount: null, managementFeeBasis: '' }, 'save')
    expect(await loadF2Form('construction', first.id)).toMatchObject({ amount: 5000, managementFeeAmount: null, managementFeeBasis: '' })
    const zero = await store.saveForm('construction', { ...base, id: first.id, managementFeeAmount: 0, managementFeeBasis: '原合同第八条' }, 'save')
    expect(await loadF2Form('construction', first.id)).toMatchObject({ managementFeeAmount: 0, managementFeeBasis: '原合同第八条' })
    const second = await store.saveForm('construction', { ...base, id: first.id, managementFeeAmount: 1200, managementFeeBasis: '另行采用依据' }, 'save')
    expect(await store.undoForm('construction', second.logId!)).toBe(true)
    expect(await loadF2Form('construction', first.id)).toMatchObject({ amount: 5000, managementFeeAmount: 0, managementFeeBasis: '原合同第八条' })
    expect((await readNativeConstructionManagementFee(mem, first.id)).history.map(row => row.amount)).toEqual([0, 1200])
    const before = await mem.select('SELECT * FROM construction_management_fee_history ORDER BY version')
    failFileInsert = true
    await expect(store.saveForm('construction', { ...base, id: first.id, managementFeeAmount: 2400 }, 'save', { add: [{ fileName: '需原件', fileSize: 1, payloadBase64: 'YQ==' }] })).rejects.toThrow('附件写入失败')
    expect(await mem.select('SELECT * FROM construction_management_fee_history ORDER BY version')).toEqual(before)
    expect(await loadF2Form('construction', first.id)).toMatchObject({ managementFeeAmount: 0 })
    failFileInsert = false
    await expect(store.saveForm('material', { name: '供应商合同', managementFeeAmount: 0 }, 'draft')).rejects.toThrow('施工主合同')
    expect(zero.id).toBe(first.id)
  })
  it('合同编辑撤回与占号同事务；后来别人采用旧号时原头/日志/历史全回滚，旧句柄不覆盖后来写入', async () => {
    const store = useContractStore()
    const base = { name: '原正式合同', no: 'RESTORE-A', projectId: 'project-contract', customerId: 'customer-contract', content: '原事实', signDate: '2026-10-04', amount: 1 }
    const first = await store.saveForm('construction', base, 'submit')
    const original = await loadF2Form('construction', first.id)
    const edited = await store.saveForm('construction', { ...original!, no: 'RESTORE-B' }, 'submit')
    await store.saveForm('company_expense', { name: '后来真实采用旧号', no: 'RESTORE-A', counterparty: '真实单位', signDate: '2026-10-04', amount: 2 }, 'submit')
    const before = await mem.select('SELECT * FROM operation_logs ORDER BY rowid')
    const evidence = await mem.select('SELECT * FROM contract_number_history ORDER BY id')
    await expect(store.undoForm('construction', edited.logId!)).rejects.toThrow('其他正式主合同重复')
    expect((await loadF2Form('construction', first.id))?.no).toBe('RESTORE-B')
    expect(await mem.select('SELECT * FROM operation_logs ORDER BY rowid')).toEqual(before)
    expect(await mem.select('SELECT * FROM contract_number_history ORDER BY id')).toEqual(evidence)
    expect(await mem.select('SELECT number FROM contract_number_claims WHERE contract_id=?', [first.id])).toEqual([{ number: 'RESTORE-B' }])
    const newer = await loadF2Form('construction', first.id)
    const latest = await store.saveForm('construction', { ...newer!, content: '后来说明' }, 'submit')
    expect(await store.undoForm('construction', edited.logId!)).toBe(false)
    expect(await store.undoForm('construction', latest.logId!)).toBe(true)
    expect((await loadF2Form('construction', first.id))?.content).toBe('原事实')
    expect(await mem.select('SELECT number FROM contract_number_claims WHERE contract_id=?', [first.id])).toEqual([{ number: 'RESTORE-B' }])
  })
  it('真实零与未知头金额分别往返，主合同与协议未知不写回旧派生历史列', async () => {
    const store = useContractStore()
    const zero = await store.saveForm('construction', { ...OUR_SELECTED, name: '真实零头', projectId: 'project-contract', customerId: 'customer-contract', content: '零金额事实', signDate: '2026-10-04', amount: 0 }, 'submit')
    expect((await loadF2Form('construction', zero.id))?.amount).toBe(0)
    await mem.execute('UPDATE contracts SET changed=1234 WHERE id=?', [zero.id])
    const prior = await loadF2Form('construction', zero.id)
    await store.saveForm('construction', { ...prior!, amount: null }, 'draft')
    expect((await loadF2Form('construction', zero.id))?.amount).toBeNull()
    expect(store.byId(zero.id)?.changed).toBeNull()
    expect(await mem.select('SELECT changed FROM contracts WHERE id=?', [zero.id])).toEqual([{ changed: 1234 }])
    const company = await store.saveForm('company_expense', { ...OUR_SELECTED, name: '未知公司合同', amount: null }, 'draft')
    expect((await loadF2Form('company_expense', company.id))?.amount).toBeNull()
    const protocol = await store.saveForm('construction', { isSupplement: true, originalContractId: zero.id, name: '未知历史协议', amount: null }, 'draft')
    expect((await loadContractSupplementForm(protocol.id))?.amount).toBeNull()
    await store.saveForm('construction', { ...prior!, amount: null }, 'submit')
    expect((await loadF2Form('construction', zero.id))!.amount).toBeNull()
  })
  it('五种主合同在同一真实事务查完整正式编号，草稿不占号且软删仍占号，协议独立不参加主号判断', async () => {
    const store = useContractStore()
    const first = await store.saveForm('construction', { ...OUR_SELECTED, no: 'ALL-KINDS', name: '原已成立主合同', projectId: 'project-contract', customerId: 'customer-contract', content: '原事实', signDate: '2026-10-04', amount: 1 }, 'submit')
    for (const kind of ['subcontract', 'material', 'other_expense'] as const) {
      const input = { ...OUR_SELECTED, no: 'ALL-KINDS', name: `重复${kind}`, projectId: 'project-contract', supplierId: 'supplier-contract', content: '待核实', signDate: '2026-10-04', amount: 1, ...(kind === 'material' ? { lineItems: [{ materialName: '真实材料', qty: 1, unit: '米', taxInclusiveUnitPrice: 1 }] } : {}) }
      const savedDraft = await store.saveForm(kind, input, 'draft')
      expect(savedDraft.warnings?.[0]).toContain('草稿编号')
      await expect(store.saveForm(kind, input, 'submit')).rejects.toThrow('其他正式主合同重复')
    }
    await expect(store.saveForm('company_expense', { ...OUR_SELECTED, no: 'ALL-KINDS', name: '重复公司号', counterparty: '真实对方', signDate: '2026-10-04', amount: 1 }, 'submit')).rejects.toThrow('其他正式主合同重复')
    const protocol = await store.saveForm('construction', { no: 'ALL-KINDS', isSupplement: true, originalContractId: first.id, name: '同父号协议', content: '协议原事实', signDate: '2026-10-04', amount: 1 }, 'submit')
    expect((await loadContractSupplementForm(protocol.id))?.ourSignatorySnapshot?.name).toBe('合同我方实际公司')
    await deleteF2Form('construction', first.id)
    await expect(store.saveForm('company_expense', { ...OUR_SELECTED, no: 'ALL-KINDS', name: '试图复用软删号', counterparty: '真实对方', signDate: '2026-10-04', amount: 1 }, 'submit')).rejects.toThrow('其他正式主合同重复')
    expect(await mem.select('SELECT number FROM contract_number_claims WHERE contract_id=?', [first.id])).toEqual([{ number: 'ALL-KINDS' }])
    const emptyNo = await store.saveForm('company_expense', { ...OUR_SELECTED, no: '', name: '既定非必填编号', counterparty: '真实对方', signDate: '2026-10-04', amount: 0 }, 'submit')
    expect((await loadF2Form('company_expense', emptyNo.id))?.amount).toBe(0)
  })
  it('native 材采整批来源与真实正文同事务，零字节与旧缺件区分且软删可恢复', async () => {
    const store = useContractStore()
    const bytes = Buffer.from('actual native material source')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const draft = { name: '真实来源合同', projectId: 'project-contract', supplierId: 'supplier-contract', amount: 20, lineItems: [{ materialName: '方管', unit: '米', qty: 1, taxInclusiveUnitPrice: 20, source: { fileName: '材料.csv', sheetName: '材料', rowNumber: 2, sourceHash: hash, externalRef: null, priceUnit: '米', quantityUnitVerified: true } }] }
    await expect(store.saveForm('material', draft, 'draft')).rejects.toThrow('实际原件')
    expect(await mem.select('SELECT id FROM contracts WHERE name=\'真实来源合同\'')).toEqual([])
    const saved = await store.saveForm('material', draft, 'draft', { add: [
      { fileName: '材料.csv', fileSize: bytes.length, payloadBase64: bytes.toString('base64'), mimeType: 'text/csv' },
      { fileName: 'empty.txt', fileSize: 0, payloadBase64: '', mimeType: 'text/plain' },
      { fileName: 'missing.txt', fileSize: 0, filePath: 'D:/旧路径不作正文' },
    ] })
    const files = await listContractFormAttachments('contract', saved.id)
    const empty = files.find(file => file.fileName === 'empty.txt')!
    const missing = files.find(file => file.fileName === 'missing.txt')!
    expect(await loadFileRefContent(empty)).toEqual({ bytes: new Uint8Array(), mimeType: 'text/plain' })
    expect(await loadFileRefContent(missing)).toBeNull()
    const form = await loadF2Form('material', saved.id)
    await store.saveForm('material', form!, 'draft', { removeIds: [empty.id] })
    expect(await loadFileRefContent(empty)).toBeNull()
    expect(await mem.select('SELECT content FROM file_payloads WHERE file_ref_id=?', [empty.id])).toEqual([{ content: '' }])
    await store.saveForm('material', form!, 'draft', { restoreIds: [empty.id] })
    expect(await loadFileRefContent(empty)).toEqual({ bytes: new Uint8Array(), mimeType: 'text/plain' })
  })
  it('材采协议自有行冻结真实原行及来源时间，后来的原合同变更和软删不能覆盖', async () => {
    const store = useContractStore()
    const draft = { ...OUR_SELECTED, name: '原方管合同', projectId: 'project-contract', supplierId: 'supplier-contract', content: '原签约事实', signDate: '2026-10-04', amount: 1800, lineItems: [{ materialName: '方管', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 20 }], deductions: [{ name: '整单优惠', amount: 200, basis: '文书优惠' }] }
    const main = await store.saveForm('material', draft, 'submit')
    const original = (await mem.select<{ id: string, updated_at: string }>('SELECT id,updated_at FROM contract_line_items WHERE contract_id=?', [main.id]))[0]!
    const protocol = await store.saveForm('material', {
      ...OUR_SELECTED,
      name: '原方管核增协议',
      isSupplement: true,
      originalContractId: main.id,
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      content: '原行每米核增1元',
      signDate: '2026-10-04',
      amount: 100,
      lineItems: [{ materialName: '方管', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 21, originalLineId: original.id, changeAmount: 100, changeBasis: '核增1×100' }],
    }, 'submit')
    const frozen = (await mem.select<{ original_line_snapshot: string, original_source_updated_at: string }>('SELECT original_line_snapshot,original_source_updated_at FROM contract_supplement_line_items WHERE supplement_id=?', [protocol.id]))[0]!
    expect(JSON.parse(frozen.original_line_snapshot)).toMatchObject({ id: original.id, contract_id: main.id, tax_inclusive_unit_price: 20, material_grade: '304' })
    expect(frozen.original_source_updated_at).toBe(original.updated_at)
    await mem.execute('UPDATE contract_line_items SET tax_inclusive_unit_price=25,deleted_at=? WHERE id=?', ['2026-10-05T00:00:00.000Z', original.id])
    const edit = await loadContractSupplementForm(protocol.id)
    expect(edit?.lineItems).toMatchObject([{ originalLineId: original.id, taxInclusiveUnitPrice: 21, changeAmount: 100 }])
    await store.saveForm('material', {
      ...OUR_SELECTED,
      ...edit!,
      content: '后来补充说明',
    }, 'save')
    expect(await mem.select('SELECT original_line_snapshot,original_source_updated_at FROM contract_supplement_line_items WHERE supplement_id=?', [protocol.id])).toEqual([frozen])
    expect(await mem.select('SELECT amount FROM contract_deductions WHERE contract_id=?', [main.id])).toEqual([{ amount: 200 }])
  })

  it('native本行税点NULL/真实0各自保存、读取与原行身份保全，头税更改不回填本行', async () => {
    const store = useContractStore()
    const saved = await store.saveForm('material', { ...OUR_SELECTED, name: '本行税点原合同', projectId: 'project-contract', supplierId: 'supplier-contract', content: '原资料', signDate: '2026-10-04', amount: 40, taxRate: 13, lineItems: [{ materialName: '未知税点方管', unit: '米', qty: 1, taxInclusiveUnitPrice: 20, applicableTaxRate: null }, { materialName: '真零税点方管', unit: '米', qty: 1, taxInclusiveUnitPrice: 20, applicableTaxRate: 0 }] }, 'submit')
    const form = await loadF2Form('material', saved.id)
    expect(form?.lineItems?.map(row => row.applicableTaxRate)).toEqual([null, 0])
    const identities = form?.lineItems?.map(row => row.id)
    await store.saveForm('material', { ...form!, taxRate: 9, note: '后来只改头税资料' }, 'save')
    const after = await loadF2Form('material', saved.id)
    expect(after?.lineItems?.map(row => row.id)).toEqual(identities)
    expect(after?.lineItems?.map(row => row.applicableTaxRate)).toEqual([null, 0])
    expect(after?.taxRate).toBe(9)
    expect(await mem.select('SELECT applicable_tax_rate FROM contract_line_items WHERE contract_id=? ORDER BY sort_order', [saved.id])).toEqual([{ applicable_tax_rate: null }, { applicable_tax_rate: 0 }])
  })

  it('六条表单经同一 Pinia store 保存真实 ID，并写入各自 canonical 实体', async () => {
    const store = useContractStore()
    const construction = await store.saveForm('construction', {
      ...OUR_SELECTED,
      no: 'CON-STORE',
      name: '施工主合同',
      projectId: 'project-contract',
      customerId: 'customer-contract',
      content: '施工总承包',
      signDate: '2026-07-01',
      amount: 1000,
    }, 'submit')
    const subcontract = await store.saveForm('subcontract', {
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
    const materialSettlement = await store.saveForm('material_settlement', {
      no: 'MAT-SETTLE-STORE',
      name: '瓷砖采购结算',
      projectId: 'project-contract',
      contractId: material.id,
      totalAmount: 200,
      settlementDate: '2026-07-26',
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
      status: '待确认',
    }])
    expect(await loadF2Form('other_settlement', settlement.id))
      .toMatchObject({ id: settlement.id, contractId: otherExpense.id })
    expect(await mem.select(`
      SELECT id, biz_type, project_id, supplier_id, contract_id
      FROM expenditure_settlements
      WHERE id = ?
    `, [materialSettlement.id])).toEqual([{
      id: materialSettlement.id,
      biz_type: '材料',
      project_id: 'project-contract',
      supplier_id: 'supplier-contract',
      contract_id: material.id,
    }])
    expect(await loadF2Form('material_settlement', materialSettlement.id))
      .toMatchObject({ id: materialSettlement.id, contractId: material.id })
    expect(await loadF2Form('other_settlement', materialSettlement.id)).toBeNull()
    await expect(store.saveForm('other_settlement', {
      id: materialSettlement.id,
      name: '错误路由覆盖',
      projectId: 'project-contract',
      contractId: otherExpense.id,
      totalAmount: 1,
    }, 'save')).rejects.toThrow('错误路由不能修改')
  })

  it('补充协议只写 contract_supplements，头、附件与操作日志同事务保存', async () => {
    const store = useContractStore()
    const original = await store.saveForm('construction', {
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
      name: '公司支出原稿',
      counterparty: '服务商',
      signDate: '2026-07-01',
      amount: 10,
    }, 'submit')
    await store.saveForm('company_expense', {
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
      name: '假关系合同',
      projectId: 'project-contract',
      customerId: 'missing-customer',
      content: '内容',
      signDate: '2026-07-01',
      amount: 1,
    }, 'submit')).rejects.toThrow('甲方客户不存在或已删除')
    await expect(store.saveForm('other_expense', {
      ...OUR_SELECTED,
      name: '假分供方合同',
      projectId: 'project-contract',
      supplierId: 'missing-supplier',
      content: '内容',
      signDate: '2026-07-01',
      amount: 1,
    }, 'submit')).rejects.toThrow('分供方不存在或已删除')
    await expect(store.saveForm('company_expense', {
      ...OUR_SELECTED,
      name: '负数公司支出',
      counterparty: '对方单位',
      signDate: '2026-07-01',
      amount: -1,
    }, 'submit')).rejects.toThrow('合同金额不能为负数')
    await expect(store.saveForm('material', {
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
      ...OUR_SELECTED,
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
    })).toEqual([])
    await mem.execute('UPDATE expenditure_settlements SET status = ? WHERE id = ?', ['confirmed', settlement.id])
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
      ...OUR_SELECTED,
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

  it('草稿合同不进入结算候选且不能被结算单引用', async () => {
    const store = useContractStore()
    const contract = await store.saveForm('other_expense', {
      ...OUR_SELECTED,
      name: '仍为草稿的其他支出合同',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
      amount: 100,
    }, 'draft')

    await expect(store.searchSettlementContracts(
      'other_settlement',
      'project-contract',
      '仍为草稿',
    )).resolves.toEqual([])
    await expect(store.saveForm('other_settlement', {
      name: '不应保存的结算',
      projectId: 'project-contract',
      contractId: contract.id,
      totalAmount: 80,
      settlementDate: '2026-07-30',
    }, 'submit')).rejects.toThrow('仍为草稿，不能办理结算')
  })

  it('编辑态锁定合同类型与主从身份，错误路由不能改写既有实体', async () => {
    const store = useContractStore()
    const contract = await store.saveForm('construction', {
      ...OUR_SELECTED,
      name: '类型锁定合同',
      projectId: 'project-contract',
      customerId: 'customer-contract',
    }, 'draft')

    expect(await loadF2Form('material', contract.id)).toBeNull()
    await expect(store.saveForm('material', {
      ...OUR_SELECTED,
      id: contract.id,
      name: '越权改类型',
      projectId: 'project-contract',
      supplierId: 'supplier-contract',
    }, 'draft')).rejects.toThrow('合同类型与当前编辑入口不一致')
    await expect(store.saveForm('construction', {
      ...OUR_SELECTED,
      id: contract.id,
      isSupplement: true,
      originalContractId: contract.id,
      name: '越权改身份',
    }, 'draft')).rejects.toThrow('主合同不能改为补充协议')
  })
})
