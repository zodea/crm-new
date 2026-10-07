import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectSupplierStore } from '~/stores/project-supplier'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
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
  mem = await createMigratedMemoryDb()
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '演示项目')`)
  await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '已有分供方')`)
  await mem.execute(`
    INSERT INTO project_suppliers (id, project_id, supplier_id)
    VALUES ('ps1', 'p1', 's1')
  `)
  setActivePinia(createPinia())
})

describe('项目分供方文件导入事务', () => {
  it('同名新分供方只创建一次，已有关系复用且全部文件挂到关系', async () => {
    const store = useProjectSupplierStore()
    await store.load()

    const result = await store.importFiles('p1', [
      {
        supplierId: 's1',
        supplierName: '已有分供方',
        files: [{ fileName: '已有-合同.pdf', category: '合同', payloadBase64: 'QQ==' }],
      },
      {
        supplierName: '南方机电',
        files: [{ fileName: '南方机电-付款.pdf', category: '付款', payloadBase64: 'Qg==' }],
      },
      {
        supplierName: ' 南方机电 ',
        files: [{ fileName: '南方机电-发票.pdf', category: '收票', payloadBase64: 'Qw==' }],
      },
    ])

    expect(result).toEqual({
      relationshipCount: 2,
      fileCount: 3,
      createdSupplierCount: 1,
      reusedRelationshipCount: 1,
    })
    const [{ n: supplierCount }] = await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM suppliers WHERE name = '南方机电'`,
    )
    const [{ n: relationshipCount }] = await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM project_suppliers WHERE project_id = 'p1'`,
    )
    const files = await mem.select<{ owner_type: string, category: string }>(
      `SELECT owner_type, category FROM file_refs ORDER BY file_name`,
    )
    const [{ n: payloadCount }] = await mem.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM file_payloads',
    )
    expect(supplierCount).toBe(1)
    expect(relationshipCount).toBe(2)
    expect(files).toHaveLength(3)
    expect(files.every(file => file.owner_type === 'project_supplier')).toBe(true)
    expect(files.map(file => file.category).sort()).toEqual(['付款', '合同', '收票'])
    expect(payloadCount).toBe(3)
  })

  it('任一文件无效时回滚新分供方、关系和先前已写文件', async () => {
    const store = useProjectSupplierStore()
    await store.load()

    await expect(store.importFiles('p1', [
      {
        supplierName: '应回滚分供方',
        files: [{ fileName: '有效文件.pdf', category: '合同', payloadBase64: 'QQ==' }],
      },
      {
        supplierId: 's1',
        supplierName: '已有分供方',
        files: [{ fileName: '   ', category: '其他' }],
      },
    ])).rejects.toThrow('附件名称不能为空')

    const [{ n: supplierCount }] = await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM suppliers WHERE name = '应回滚分供方'`,
    )
    const [{ n: relationshipCount }] = await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM project_suppliers WHERE project_id = 'p1'`,
    )
    const [{ n: fileCount }] = await mem.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM file_refs',
    )
    expect(supplierCount).toBe(0)
    expect(relationshipCount).toBe(1)
    expect(fileCount).toBe(0)
  })
})
