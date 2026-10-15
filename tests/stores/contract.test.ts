import type { TestDb } from '../helpers/memory-db'
// #90 合同域 store 单测:mock connection 路由到 sql.js 内存库,node 直测唯一写路径 action 闭环。
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadF2Form } from '~/lib/contract/forms'
import { restoreRecord, softDelete } from '~/lib/db/soft-delete'
import { useContractStore } from '~/stores/contract'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

const contractStoreTestState = vi.hoisted(() => ({
  failCompanyExpenseSelect: false,
  failCoreContractSelect: false,
  companyExpenseSelectOverrides: [] as Array<() => Promise<unknown[]>>,
}))

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => {
    if (
      contractStoreTestState.failCoreContractSelect
      && sql.includes('SELECT contract.*')
      && sql.includes('FROM contracts AS contract')
    ) {
      throw new Error('模拟核心合同刷新失败')
    }
    if (
      sql.includes('company_expense_contracts')
      && !params?.length
      && contractStoreTestState.companyExpenseSelectOverrides.length > 0
    ) {
      return contractStoreTestState.companyExpenseSelectOverrides.shift()!()
    }
    if (
      contractStoreTestState.failCompanyExpenseSelect
      && sql.includes('company_expense_contracts')
      && !params?.length
    ) {
      throw new Error('模拟辅助列表刷新失败')
    }
    return mem.select(sql, params)
  },
  withTransaction: async <T>(
    work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>,
  ) => {
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
  contractStoreTestState.failCompanyExpenseSelect = false
  contractStoreTestState.failCoreContractSelect = false
  contractStoreTestState.companyExpenseSelectOverrides = []
  mem = await createMigratedMemoryDb()
  await mem.execute(`INSERT INTO customers (id, name) VALUES ('customer-1', '演示客户')`)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id)
    VALUES ('p1', '演示项目', 'customer-1')
  `)
  await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-1', '演示分供方')`)
  setActivePinia(createPinia())
})

describe('contract store:唯一写路径 action 闭环', () => {
  it('native 公司与其他支出合同金额 NULL 贯穿列表和结算候选，真实零单独保留', async () => {
    await mem.execute('INSERT INTO company_expense_contracts(id,no,name,amount,status) VALUES(\'company-null\',\'NULL-C\',\'未知公司金额\',NULL,\'履约中\'),(\'company-zero\',\'ZERO-C\',\'真实零公司金额\',0,\'履约中\')')
    await mem.execute('INSERT INTO contracts(id,no,name,kind,project_id,supplier_id,amount,status) VALUES(\'other-null\',\'NULL-O\',\'未知其他金额\',\'其他支出\',\'p1\',\'supplier-1\',NULL,\'履约中\'),(\'other-zero\',\'ZERO-O\',\'真实零其他金额\',\'其他支出\',\'p1\',\'supplier-1\',0,\'履约中\')')
    const store = useContractStore()
    await store.loadAux('company_expense')
    await store.loadAux('other_expense')
    expect(store.auxByKind('company_expense').find(row => row.id === 'company-null')?.amount).toBeNull()
    expect(store.auxByKind('company_expense').find(row => row.id === 'company-zero')?.amount).toBe(0)
    expect(store.auxByKind('other_expense').find(row => row.id === 'other-null')?.amount).toBeNull()
    expect(store.auxByKind('other_expense').find(row => row.id === 'other-zero')?.amount).toBe(0)
    expect(await store.searchSettlementContracts('other_settlement', 'p1', '未知其他')).toEqual([{ id: 'other-null', label: '未知其他金额', hint: 'NULL-O · 金额未知' }])
    expect(await store.searchSettlementContracts('other_settlement', 'p1', '真实零')).toEqual([{ id: 'other-zero', label: '真实零其他金额', hint: 'ZERO-O · 0.00' }])
  })
  it('独立 Native 正式路径保未知金额与原文主体，不凭中央目录扩展猜映射或补零', async () => {
    await mem.execute('INSERT INTO contracts(id,name,kind,project_id,customer_id,amount,party_a,status) VALUES(\'legacy-formal\',\'原正式合同\',\'施工\',\'p1\',\'customer-1\',NULL,\'  历史我方原文  \',\'履约中\')')
    const store = useContractStore()
    const draft = await loadF2Form('construction', 'legacy-formal')
    expect(draft).toMatchObject({ amount: null, ourSignatoryId: null, ourSignatorySnapshot: null, legacyPartyA: '  历史我方原文  ' })
    await store.saveForm('construction', { ...draft!, content: '补原事实说明', signDate: '2026-10-04' }, 'submit')
    expect(await mem.select('SELECT amount,party_a,our_signatory_id,our_signatory_snapshot FROM contracts WHERE id=?', ['legacy-formal'])).toEqual([{ amount: null, party_a: '  历史我方原文  ', our_signatory_id: null, our_signatory_snapshot: null }])
    expect(store.byId('legacy-formal')).toMatchObject({ amount: null, changed: null })
    expect(await mem.select('SELECT * FROM our_signatories')).toEqual([])
  })
  it('saveForm: canonical action 落库并聚合只读金额', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('construction', {
      name: '测试施工合同',
      projectId: 'p1',
      customerId: 'customer-1',
      amount: 100.5,
    }, 'draft')
    expect(store.list).toHaveLength(1)
    expect(store.byId(id)).toMatchObject({
      id,
      name: '测试施工合同',
      kind: '施工',
      status: '草稿',
      projectId: 'p1',
      supplierId: null,
      amount: 100.5,
      changed: 100.5,
      settled: 0,
      invoiced: 0,
      paid: 0,
    })
  })

  it('施工合同变更后金额包含有效增补与已审定甲方变洽签', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('construction', {
      name: '变更金额合同',
      projectId: 'p1',
      customerId: 'customer-1',
      amount: 100,
    }, 'draft')
    await mem.execute(`
      INSERT INTO contract_supplements (
        id, contract_id, no, name, amount, status
      )
      VALUES ('supplement-1', ?, 'BC-001', '有效增补', 20, '有效')
    `, [id])
    await mem.execute(`
      INSERT INTO owner_change_orders (
        id, project_id, contract_id, change_no, tax_inc_amount, status, approval_date
      )
      VALUES
        ('change-approved', 'p1', ?, 'BG-001', 30, 'approved', ''),
        ('change-legacy', 'p1', ?, 'BG-002', 10, 'draft', '2025-12-01'),
        ('change-draft', 'p1', ?, 'BG-003', 40, 'draft', '')
    `, [id, id, id])

    await store.load()
    expect(store.byId(id)?.changed).toBe(160)
  })

  it('lookup actions return real IDs and keep settlement contracts project-scoped', async () => {
    const store = useContractStore()
    await mem.execute(`INSERT INTO customers (id, name) VALUES ('customer-2', '第二客户')`)
    await mem.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES ('p2', '第二项目', 'customer-2')
    `)
    await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-2', '第二分供方')`)
    const construction = await store.saveForm('construction', {
      name: '演示施工合同',
      projectId: 'p1',
      customerId: 'customer-1',
      content: '施工合同内容',
      signDate: '2026-07-26',
    }, 'submit')
    const otherExpenseP1 = await store.saveForm('other_expense', {
      name: '演示其他支出合同',
      projectId: 'p1',
      supplierId: 'supplier-1',
      amount: 88,
      content: '其他支出合同内容',
      signDate: '2026-07-26',
    }, 'submit')
    await store.saveForm('other_expense', {
      name: '第二项目其他支出合同',
      projectId: 'p2',
      supplierId: 'supplier-2',
      amount: 99,
      content: '第二项目其他支出合同内容',
      signDate: '2026-07-26',
    }, 'submit')

    await expect(store.searchProjects('演示')).resolves.toEqual([
      { id: 'p1', label: '演示项目' },
    ])
    await expect(store.searchCustomers('演示')).resolves.toEqual([
      { id: 'customer-1', label: '演示客户' },
    ])
    await expect(store.searchSuppliers('演示')).resolves.toEqual([
      { id: 'supplier-1', label: '演示分供方' },
    ])
    await expect(store.searchOriginalContracts('construction', '演示施工')).resolves.toEqual([
      {
        id: construction.id,
        label: '演示施工合同',
        hint: expect.any(String),
      },
    ])
    await expect(store.searchSettlementContracts(
      'other_settlement',
      'p1',
      '其他支出',
    )).resolves.toEqual([
      {
        id: otherExpenseP1.id,
        label: '演示其他支出合同',
        hint: expect.stringContaining('88.00'),
      },
    ])
    await expect(store.searchSettlementContracts(
      'other_settlement',
      null,
      '其他支出',
    )).resolves.toEqual([])
  })

  it('编辑仍经 canonical action 回写并返回日志 id', async () => {
    const store = useContractStore()
    const created = await store.saveForm('construction', {
      name: '旧名',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    const updated = await store.saveForm('construction', {
      id: created.id,
      name: '新名',
      projectId: 'p1',
      customerId: 'customer-1',
      amount: 8.88,
    }, 'draft')
    expect(updated.logId).toBeTruthy()
    expect(store.byId(created.id)).toMatchObject({ name: '新名', amount: 8.88 })
  })

  it('removeForm/undoForm:软删隐藏出列表,按日志 id 撤回复原', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('construction', {
      name: '要删的',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    const logId = await store.removeForm('construction', id)
    expect(logId).toBeTruthy()
    expect(store.list).toHaveLength(0)
    expect(await store.undoForm('construction', logId!)).toBe(true)
    expect(store.list).toHaveLength(1)
    expect(store.byId(id)!.name).toBe('要删的')
  })

  it('辅助合同删除与撤回不因后续列表刷新失败而误报写入失败', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('company_expense', {
      name: '待删除公司支出合同',
      counterparty: '服务商',
      signDate: '2026-07-30',
      amount: 100,
    }, 'submit')

    contractStoreTestState.failCompanyExpenseSelect = true
    const logId = await store.removeForm('company_expense', id)
    expect(logId).toBeTruthy()
    expect(store.auxError('company_expense')).toBe('模拟辅助列表刷新失败')
    expect(await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM company_expense_contracts WHERE id = ?',
      [id],
    )).toEqual([{ deleted_at: expect.any(String) }])

    await expect(store.undoForm('company_expense', logId!)).resolves.toBe(true)
    expect(store.auxError('company_expense')).toBe('模拟辅助列表刷新失败')
    expect(await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM company_expense_contracts WHERE id = ?',
      [id],
    )).toEqual([{ deleted_at: null }])
  })

  it('辅助列表仅采纳最新请求且不占用核心合同 loading', async () => {
    const store = useContractStore()
    let resolveFirst!: (rows: unknown[]) => void
    const firstRows = new Promise<unknown[]>((resolve) => {
      resolveFirst = resolve
    })
    contractStoreTestState.companyExpenseSelectOverrides.push(
      () => firstRows,
      async () => [{
        id: 'new',
        no: 'NEW',
        name: '新请求',
        category: '软件',
        counterparty: '新服务商',
        service_period: '一年',
        amount: 200,
        sign_date: '2026-07-30',
        status: '履约中',
      }],
    )

    const firstLoad = store.loadAux('company_expense')
    expect(store.loading).toBe(false)
    expect(store.auxLoadingFor('company_expense')).toBe(true)

    await store.loadAux('company_expense')
    resolveFirst([{
      id: 'old',
      no: 'OLD',
      name: '旧请求',
      category: '服务',
      counterparty: '旧服务商',
      service_period: '一月',
      amount: 100,
      sign_date: '2026-07-01',
      status: '草稿',
    }])
    await firstLoad

    expect(store.auxLoadingFor('company_expense')).toBe(false)
    expect(store.auxByKind('company_expense').map(row => row.name)).toEqual(['新请求'])
  })

  it('核心合同写入成功后刷新失败不会误报保存失败', async () => {
    const store = useContractStore()
    contractStoreTestState.failCoreContractSelect = true

    const result = await store.saveForm('construction', {
      name: '已提交但刷新失败',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')

    expect(result.id).toBeTruthy()
    expect(store.loadError).toBe('模拟核心合同刷新失败')
    expect(await mem.select<{ name: string }>(
      'SELECT name FROM contracts WHERE id = ?',
      [result.id],
    )).toEqual([{ name: '已提交但刷新失败' }])
  })

  it('其他支出删除成功后核心合同刷新失败不会误报删除失败', async () => {
    const store = useContractStore()
    const { id } = await store.saveForm('other_expense', {
      name: '待删除其他支出',
      projectId: 'p1',
      supplierId: 'supplier-1',
      content: '服务内容',
      signDate: '2026-07-30',
      amount: 100,
    }, 'submit')

    contractStoreTestState.failCoreContractSelect = true
    const logId = await store.removeForm('other_expense', id)

    expect(logId).toBeTruthy()
    expect(store.loadError).toBe('模拟核心合同刷新失败')
    expect(store.auxByKind('other_expense')).toHaveLength(0)
    expect(await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM contracts WHERE id = ?',
      [id],
    )).toEqual([{ deleted_at: expect.any(String) }])
  })

  it('祖先过滤:父项目软删则合同隐藏,恢复项目即重现(ADR 0003 只标父级)', async () => {
    const store = useContractStore()
    await store.saveForm('construction', {
      name: '子合同',
      projectId: 'p1',
      customerId: 'customer-1',
    }, 'draft')
    await softDelete(mem, 'projects', 'p1')
    await store.load()
    expect(store.list).toHaveLength(0)
    await restoreRecord(mem, 'projects', 'p1')
    await store.load()
    expect(store.list).toHaveLength(1)
  })
})
