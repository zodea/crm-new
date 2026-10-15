import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMasterDataReadStore } from '~/stores/master-data-read'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  select: <T>(sql: string, params?: unknown[]) => mem.select<T>(sql, params),
}))

beforeEach(async () => {
  mem = await createMigratedMemoryDb()
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
})
