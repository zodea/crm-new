import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMaterialStockSummary,
  getOwnerMaterialSummary,
  listMaterialFormAttachments,
  loadMaterialForm,
} from '~/lib/material/forms'
import { useMaterialStore } from '~/stores/material'
import { createMigratedMemoryDb } from '../helpers/memory-db'

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
  mem = await createMigratedMemoryDb()
  setActivePinia(createPinia())
  await mem.execute(`
    INSERT INTO customers (id, name, status)
    VALUES
      ('customer-material', '材料甲方', 'submitted'),
      ('customer-other', '其他甲方', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, approval_status)
    VALUES
      ('project-material', '材料项目', 'customer-material', 'submitted'),
      ('project-other', '其他项目', 'customer-other', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO suppliers (id, name, approval_status)
    VALUES ('supplier-material', '材料分供方', 'approved')
  `)
  await mem.execute(`
    UPDATE suppliers
    SET supplier_category = '材料供应商'
    WHERE id = 'supplier-material'
  `)
  await mem.execute(`
    INSERT INTO project_suppliers (id, project_id, supplier_id, status)
    VALUES ('project-supplier-material', 'project-material', 'supplier-material', 'contracted')
  `)
  await mem.execute(`
    INSERT INTO crews (id, name, status)
    VALUES ('crew-material', '材料班组', '在场')
  `)
  await mem.execute(`
    INSERT INTO contracts (
      id, no, name, kind, project_id, supplier_id, amount, changed, status
    )
    VALUES
      (
        'contract-material', 'MAT-F4', '材料采购合同', '材采',
        'project-material', 'supplier-material', 1000, 1000, '履约中'
      ),
      (
        'contract-other', 'MAT-OTHER', '其他项目材料合同', '材采',
        'project-other', 'supplier-material', 2000, 2000, '履约中'
      )
  `)
})

afterEach(() => {
  mem.close()
})

describe('f4 物资事实、派生库存与甲供材总控', () => {
  it('九类新表单共用 store 写入，过账后只从事实派生数量与金额', async () => {
    const store = useMaterialStore()
    const requisition = await store.saveForm('mat_requisition', {
      no: 'XL-F4',
      projectId: 'project-material',
      contractId: 'contract-material',
      applicant: '张工',
      requisitionDate: '2026-07-20',
      requiredDate: '2026-07-25',
      materialName: '瓷砖',
      spec: '600×600',
      unit: '㎡',
      plannedQty: 12,
      warehouse: '中心仓',
      purpose: '样板间',
    }, 'post')
    const arrival = await store.saveForm('mat_arrival', {
      no: 'DH-F4',
      projectId: 'project-material',
      supplierId: 'supplier-material',
      contractId: 'contract-material',
      requisitionId: requisition.id,
      warehouse: '中心仓',
      arrivalDate: '2026-07-21',
      receiver: '李工',
      qualityResult: '合格',
      lines: [{
        materialName: '瓷砖',
        spec: '600×600',
        unit: '㎡',
        qty: 10,
        unitPrice: 23.8,
      }],
    }, 'post', {
      add: [{
        fileName: '送货单.pdf',
        filePath: 'F:\\materials\\送货单.pdf',
        category: '送货单',
      }],
    })
    const use = await store.saveForm('mat_use', {
      no: 'LY-F4',
      projectId: 'project-material',
      warehouse: '中心仓',
      useDate: '2026-07-22',
      materialName: '瓷砖',
      spec: '600×600',
      unit: '㎡',
      qty: 4,
      receiver: '王工',
      crewId: 'crew-material',
      purpose: '铺贴',
    }, 'post')
    const stockCheck = await store.saveForm('stock_check', {
      no: 'PD-F4',
      warehouse: '中心仓',
      checker: '赵工',
      checkDate: '2026-07-23',
      lines: [{
        materialName: '瓷砖',
        spec: '600×600',
        unit: '㎡',
        bookQty: 6,
        actualQty: 5,
        varianceAmount: -23.8,
      }],
    }, 'post')

    const ownerControl = await store.saveForm('owner_control', {
      no: 'JGZK-F4',
      projectId: 'project-material',
      customerId: 'customer-material',
      materialName: '入户门',
      spec: '1000×2100',
      unit: '樘',
      controlQty: 20,
    }, 'post')
    await store.saveForm('owner_requisition', {
      no: 'JGXL-F4',
      projectId: 'project-material',
      applicant: '张工',
      applicationDate: '2026-07-20',
      requiredDate: '2026-07-25',
      materialName: '入户门',
      spec: '1000×2100',
      unit: '樘',
      plannedQty: 15,
    }, 'post')
    await store.saveForm('owner_arrival', {
      no: 'JGDH-F4',
      projectId: 'project-material',
      warehouse: '中心仓',
      arrivalDate: '2026-07-21',
      receiver: '李工',
      materialName: '入户门',
      spec: '1000×2100',
      unit: '樘',
      qty: 12,
      qualityResult: '合格',
    }, 'post')
    await store.saveForm('owner_use', {
      no: 'JGLY-F4',
      projectId: 'project-material',
      useDate: '2026-07-22',
      materialName: '入户门',
      unit: '樘',
      qty: 4,
      receiver: '王工',
      crewId: 'crew-material',
      purpose: '首层安装',
    }, 'post')
    await store.saveForm('owner_direct', {
      no: 'JGZR-F4',
      projectId: 'project-material',
      customerId: 'customer-material',
      transactionDate: '2026-07-23',
      materialName: '入户门',
      unit: '樘',
      qty: 3,
      purpose: '直供安装',
      useLocation: '二层',
    }, 'post')

    expect(await loadMaterialForm('mat_requisition', requisition.id)).toMatchObject({
      status: 'submitted',
      plannedQty: 12,
      arrivedQty: 10,
      remainingQty: 2,
    })
    expect(await loadMaterialForm('mat_arrival', arrival.id)).toMatchObject({
      status: 'posted',
      stockStatus: 'stored',
      materialSummary: '瓷砖',
      totalQty: 10,
      totalAmount: 238,
    })
    expect(await loadMaterialForm('stock_check', stockCheck.id)).toMatchObject({
      status: 'effective',
      itemCount: 1,
      varianceQty: -1,
      varianceAmount: -23.8,
    })
    expect(await getMaterialStockSummary('中心仓', '瓷砖', '600×600', '㎡')).toEqual({
      receivedQty: 10,
      usedQty: 4,
      adjustedQty: -1,
      availableQty: 5,
    })
    expect(await getOwnerMaterialSummary('project-material', '入户门', '樘')).toEqual({
      controlQty: 20,
      arrivedQty: 15,
      usedQty: 7,
      remainingQty: 13,
      stockQty: 8,
    })
    expect(store.byId('owner_control', ownerControl.id)).toMatchObject({
      status: 'effective',
      remainingQty: 13,
    })
    expect(await listMaterialFormAttachments('mat_arrival', arrival.id)).toEqual([
      expect.objectContaining({ fileName: '送货单.pdf' }),
    ])
    await expect(store.saveForm('mat_use', {
      id: use.id,
      projectId: 'project-material',
      warehouse: '中心仓',
      useDate: '2026-07-22',
      materialName: '瓷砖',
      spec: '600×600',
      unit: '㎡',
      qty: 4,
      receiver: '王工',
    }, 'post')).rejects.toThrow('不能重复操作')
  })

  it('过账拒绝错合同、超库存、过期账面量与超总控量', async () => {
    const store = useMaterialStore()
    await expect(store.saveForm('mat_requisition', {
      projectId: 'project-material',
      contractId: 'contract-other',
      applicant: '张工',
      requisitionDate: '2026-07-20',
      materialName: '砂浆',
      unit: '吨',
      plannedQty: 1,
    }, 'post')).rejects.toThrow('材料采购合同不属于所选项目')
    const otherRequisition = await store.saveForm('mat_requisition', {
      projectId: 'project-other',
      contractId: 'contract-other',
      applicant: '李工',
      requisitionDate: '2026-07-20',
      materialName: '砂浆',
      unit: '吨',
      plannedQty: 1,
    }, 'post')
    await expect(store.saveForm('mat_arrival', {
      projectId: 'project-material',
      supplierId: 'supplier-material',
      requisitionId: otherRequisition.id,
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      lines: [{
        materialName: '砂浆',
        unit: '吨',
        qty: 1,
      }],
    }, 'post')).rejects.toThrow('关联下料单不属于所选项目')
    await expect(store.saveForm('owner_control', {
      projectId: 'project-material',
      customerId: 'customer-other',
      materialName: '洁具',
      unit: '套',
      controlQty: 2,
    }, 'post')).rejects.toThrow('甲供单位不属于所选项目')
    await expect(store.saveForm('mat_requisition', {
      projectId: 'project-material',
      contractId: null,
      applicant: '张工',
      requisitionDate: '2026-07-20',
      materialName: '砂浆',
      unit: '吨',
      plannedQty: 0,
    }, 'post')).rejects.toThrow('计划量必须大于 0')
    await expect(store.saveForm('mat_use', {
      projectId: 'project-material',
      warehouse: '中心仓',
      useDate: '2026-07-20',
      materialName: '砂浆',
      unit: '吨',
      qty: 1,
      receiver: '张工',
    }, 'post')).rejects.toThrow('库存不足')
    await expect(store.saveForm('stock_check', {
      warehouse: '中心仓',
      checker: '张工',
      checkDate: '2026-07-20',
      lines: [{
        materialName: '砂浆',
        unit: '吨',
        bookQty: 1,
        actualQty: 1,
      }],
    }, 'post')).rejects.toThrow('账面量已变化')

    await store.saveForm('owner_control', {
      projectId: 'project-material',
      customerId: 'customer-material',
      materialName: '洁具',
      unit: '套',
      controlQty: 2,
    }, 'post')
    await expect(store.saveForm('owner_arrival', {
      projectId: 'project-material',
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      materialName: '洁具',
      unit: '套',
      qty: 3,
    }, 'post')).rejects.toThrow('超过总控量')
    await expect(store.saveForm('owner_direct', {
      projectId: 'project-material',
      customerId: 'customer-material',
      transactionDate: '2026-07-20',
      materialName: '洁具',
      unit: '套',
      qty: 3,
      useLocation: '首层',
    }, 'post')).rejects.toThrow('总控余量不足')
  })

  it('软删除与恢复会立即改变派生库存，不维护第二份汇总', async () => {
    const store = useMaterialStore()
    await store.saveForm('mat_arrival', {
      projectId: 'project-material',
      supplierId: 'supplier-material',
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      lines: [{
        materialName: '腻子',
        spec: '',
        unit: '包',
        qty: 8,
      }],
    }, 'post')
    const use = await store.saveForm('mat_use', {
      projectId: 'project-material',
      warehouse: '中心仓',
      useDate: '2026-07-21',
      materialName: '腻子',
      spec: '',
      unit: '包',
      qty: 3,
      receiver: '张工',
    }, 'post')

    expect((await getMaterialStockSummary('中心仓', '腻子', '', '包')).availableQty).toBe(5)
    expect(await store.removeForm('mat_use', use.id)).toBeTruthy()
    expect((await getMaterialStockSummary('中心仓', '腻子', '', '包')).availableQty).toBe(8)
    expect(await store.restoreForm('mat_use', use.id)).toBeTruthy()
    expect((await getMaterialStockSummary('中心仓', '腻子', '', '包')).availableQty).toBe(5)
  })

  it('到货表单 lookup 与保存统一限定项目材料分供方', async () => {
    const store = useMaterialStore()
    await mem.execute(`
      INSERT INTO suppliers (id, name, supplier_category, approval_status)
      VALUES
        ('supplier-legacy-null', '旧材料分供方', NULL, 'approved'),
        ('supplier-labor', '劳务分供方', '劳务分包商', 'approved')
    `)
    await mem.execute(`
      INSERT INTO project_suppliers (id, project_id, supplier_id, status)
      VALUES
        ('project-supplier-legacy-null', 'project-material', 'supplier-legacy-null', 'contracted'),
        ('project-supplier-labor', 'project-material', 'supplier-labor', 'contracted')
    `)
    const requisition = await store.saveForm('mat_requisition', {
      no: 'XL-LOOKUP',
      projectId: 'project-material',
      contractId: 'contract-material',
      applicant: '张工',
      requisitionDate: '2026-07-20',
      materialName: '瓷砖',
      unit: '㎡',
      plannedQty: 12,
    }, 'post')

    await expect(store.searchContracts('project-material', '材料')).resolves.toEqual([
      {
        id: 'contract-material',
        label: '材料采购合同',
        hint: 'MAT-F4',
      },
    ])
    await expect(store.searchContracts('project-other', '材料')).resolves.toEqual([
      {
        id: 'contract-other',
        label: '其他项目材料合同',
        hint: 'MAT-OTHER',
      },
    ])
    await expect(store.searchRequisitions('project-material', '瓷砖')).resolves.toEqual([
      {
        id: requisition.id,
        label: 'XL-LOOKUP · 瓷砖',
        hint: '计划 12 ㎡',
      },
    ])
    await expect(store.searchRequisitions('project-other', '瓷砖')).resolves.toEqual([])

    const projectSuppliers = await store.searchSuppliers('分供方', 'project-material')
    expect(projectSuppliers.map(option => option.id).sort()).toEqual([
      'supplier-legacy-null',
      'supplier-material',
    ])

    const legacyArrival = await store.saveForm('mat_arrival', {
      projectId: 'project-material',
      supplierId: 'supplier-legacy-null',
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      lines: [{ materialName: '水泥', unit: '袋', qty: 1 }],
    }, 'post')
    expect(store.byId('mat_arrival', legacyArrival.id)).toMatchObject({
      supplierId: 'supplier-legacy-null',
      status: 'posted',
    })
    await expect(store.saveForm('mat_arrival', {
      projectId: 'project-material',
      supplierId: 'supplier-labor',
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      lines: [{ materialName: '水泥', unit: '袋', qty: 1 }],
    }, 'post')).rejects.toThrow('乙供材只能关联材料供应商')
    await expect(store.saveForm('mat_arrival', {
      projectId: 'project-other',
      supplierId: 'supplier-material',
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      lines: [{ materialName: '水泥', unit: '袋', qty: 1 }],
    }, 'post')).rejects.toThrow('分供方未关联所选项目')
  })

  it('附件失败会原子回滚单头、明细和操作日志', async () => {
    const store = useMaterialStore()
    const logsBefore = await mem.select('SELECT COUNT(*) AS n FROM operation_logs')
    failFileInsert = true
    await expect(store.saveForm('mat_arrival', {
      no: 'DH-ROLLBACK',
      projectId: 'project-material',
      supplierId: 'supplier-material',
      warehouse: '中心仓',
      arrivalDate: '2026-07-20',
      lines: [{
        materialName: '钢筋',
        spec: 'HRB400',
        unit: '吨',
        qty: 2,
      }],
    }, 'post', {
      add: [{ fileName: '失败附件.pdf' }],
    })).rejects.toThrow('模拟附件写入失败')

    expect(await mem.select(`
      SELECT id FROM material_arrivals WHERE no = 'DH-ROLLBACK'
    `)).toEqual([])
    expect(await mem.select(`
      SELECT id FROM material_arrival_lines
    `)).toEqual([])
    expect(await mem.select('SELECT COUNT(*) AS n FROM operation_logs')).toEqual(logsBefore)
  })
})
