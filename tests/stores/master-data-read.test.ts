import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useMasterDataReadStore } from '~/stores/master-data-read'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())

  await mem.execute(`
    INSERT INTO customers (id, name, aliases, tax_no, contact, status)
    VALUES
      ('customer-1', '睿航建设', '["睿航","瑞航"]', '914400001', '陈经理', 'submitted'),
      ('customer-deleted', '已删客户', '', '914400002', '', 'draft')
  `)
  await mem.execute(`
    UPDATE customers SET deleted_at = '2026-07-26T00:00:00.000Z'
    WHERE id = 'customer-deleted'
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, manager)
    VALUES ('project-1', '合和新城', 'customer-1', '项目经理')
  `)
  await mem.execute(`
    INSERT INTO crews (id, name, trade, contact_name, contact_phone, status)
    VALUES ('crew-1', '泥水班组', '泥水', '班组长', '13800138000', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO workers (
      id, name, trade, phone, crew_id, current_project_id, project_status
      , id_card, safety_education
    )
    VALUES (
      'worker-1', '张师傅', '泥水', '13900139000',
      'crew-1', 'project-1', '在场',
      '440101199001011234', 1
    )
  `)
  await mem.execute(`
    INSERT INTO target_costs (
      id, project_id, name, is_baseline, tax_inclusive_total, signed_contract_sum
    )
    VALUES ('target-1', 'project-1', '首版目标成本', 1, 120, 80)
  `)
})

afterEach(() => {
  mem.close()
})

describe('master data read store', () => {
  it('记录各资料库成功读取的空快照，刷新不再视为首次读取', async () => {
    const store = useMasterDataReadStore()
    expect(store.loadedByKind.customer).toBeUndefined()
    await mem.execute('UPDATE customers SET deleted_at = \'2026-09-08T00:00:00Z\'')
    await store.load('customer')
    expect(store.rowsByKind.customer).toEqual([])
    expect(store.loadedByKind.customer).toBe(true)
    expect(store.loadedByKind.crew).toBeUndefined()
    const refresh = store.load('customer')
    expect(store.loadingByKind.customer).toBe(true)
    expect(store.loadedByKind.customer).toBe(true)
    await refresh
  })
  it('按领域保存独立列表切片并解析跨表名称', async () => {
    const store = useMasterDataReadStore()

    await store.load('customer')
    await store.load('crew')
    await store.load('worker')
    await store.load('target_cost')

    expect(store.rowsByKind.customer).toEqual([
      expect.objectContaining({
        id: 'customer-1',
        name: '睿航建设',
        aliases: ['睿航', '瑞航'],
        contact: '陈经理',
      }),
    ])
    expect(store.rowsByKind.crew).toEqual([
      expect.objectContaining({
        id: 'crew-1',
        memberCount: 1,
        activeMemberCount: 1,
        projectCount: 1,
        projectNames: ['合和新城'],
      }),
    ])
    expect(store.rowsByKind.worker).toEqual([
      expect.objectContaining({
        id: 'worker-1',
        crewName: '泥水班组',
        projectName: '合和新城',
        idCard: '440101199001011234',
        safetyEducationLabel: '已完成',
      }),
    ])
    expect(store.rowsByKind.target_cost).toEqual([
      expect.objectContaining({
        id: 'target-1',
        projectName: '合和新城',
        isBaselineLabel: '是',
      }),
    ])
    expect(store.loadingByKind.worker).toBe(false)
  })

  it('lookup 由 store 统一隐藏软删记录并支持客户别名/税号', async () => {
    const store = useMasterDataReadStore()

    await expect(store.searchCustomers('瑞航')).resolves.toEqual([
      { id: 'customer-1', label: '睿航建设' },
    ])
    await expect(store.searchCustomers('914400001')).resolves.toEqual([
      { id: 'customer-1', label: '睿航建设' },
    ])
    await expect(store.searchCustomers('已删')).resolves.toEqual([])
    await expect(store.searchProjects('合和')).resolves.toEqual([
      { id: 'project-1', label: '合和新城' },
    ])
    await expect(store.searchCrews('泥水')).resolves.toEqual([
      { id: 'crew-1', label: '泥水班组' },
    ])
  })

  it('客户祖先删除后项目不再计入班组或工人列表，但跨项目工人主档仍保留', async () => {
    const store = useMasterDataReadStore()
    await mem.execute(`
      UPDATE customers
      SET deleted_at = '2026-07-30T00:00:00.000Z'
      WHERE id = 'customer-1'
    `)

    await store.load('crew')
    await store.load('worker')

    expect(store.rowsByKind.crew).toEqual([
      expect.objectContaining({
        id: 'crew-1',
        projectCount: 0,
        projectNames: [],
      }),
    ])
    expect(store.rowsByKind.worker).toEqual([
      expect.objectContaining({
        id: 'worker-1',
        projectName: null,
      }),
    ])
  })
})
