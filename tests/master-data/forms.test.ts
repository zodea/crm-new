import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteMasterDataRecord,
  listFormAttachments,
  loadCustomerForm,
  loadProjectForm,
  loadTargetCostForm,
  restoreMasterDataRecord,
  saveProjectForm,
  saveTargetCostForm,
} from '~/lib/master-data/forms'
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
    INSERT INTO customers (id, name, contact, status)
    VALUES ('customer-ref', '引用客户', '陈经理', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO projects (id, name, customer_id, manager, approval_status)
    VALUES ('project-ref', '引用项目', 'customer-ref', '项目经理', 'submitted')
  `)
  await mem.execute(`
    INSERT INTO crews (id, name, trade, contact_name, contact_phone, status)
    VALUES ('crew-ref', '引用班组', '泥水', '班组长', '13800138000', 'submitted')
  `)
})

afterEach(() => {
  mem.close()
})

describe('f1 整页表单领域 action', () => {
  it('草稿跳过提交必填校验，项目与目标成本头表都能保存后重新载入', async () => {
    const project = await saveProjectForm({
      name: '',
      customerId: null,
      manager: '',
    }, 'draft')
    const targetCost = await saveTargetCostForm({
      projectId: null,
      name: '',
    }, 'draft')

    expect((await loadProjectForm(project.id))?.approvalStatus).toBe('draft')
    expect(await loadTargetCostForm(targetCost.id)).toMatchObject({
      projectId: null,
      status: 'draft',
    })
  })

  it('项目与目标成本提交校验真实关系与非负数，不接受名称假装外键', async () => {
    await expect(saveProjectForm({
      name: '测试项目',
      customerId: '引用客户',
      manager: '项目经理',
    }, 'submit')).rejects.toThrow('客户不存在')
    await expect(saveTargetCostForm({
      projectId: 'project-ref',
      name: '负数目标',
      plannedProfit: -0.01,
    }, 'submit')).rejects.toThrow('计划利润不能为负数')

    await mem.execute(`
      UPDATE customers
      SET deleted_at = '2026-07-25T00:00:00.000Z'
      WHERE id = 'customer-ref'
    `)
    await expect(saveTargetCostForm({
      projectId: 'project-ref',
      name: '不可见项目目标',
    }, 'submit')).rejects.toThrow('项目不存在或已删除')
  })

  it('项目与目标成本表单的全部可编辑标量字段按真实 ID 写入并完整回显', async () => {
    await mem.execute('INSERT INTO customers (id, name, contact, status) VALUES (\'customer-second\', \'岭南建设单位\', \'王经理\', \'submitted\')')
    const project = await saveProjectForm({
      name: '珠江新城项目',
      contractName: '珠江新城精装合同',
      code: 'ZJXC-01',
      customerId: 'customer-ref',
      secondaryCustomerId: 'customer-second',
      region: '广州·天河',
      address: '珠江新城 1 号',
      operationType: '自营',
      type: '住宅精装',
      area: 12000,
      contractAmount: 30000000,
      overview: '两栋住宅',
      status: '施工中',
      startDate: '2026-01-01',
      plannedEnd: '2027-01-01',
      plannedDuration: 365,
      actualEnd: '',
      developerSupervisor: '甲方代表',
      manager: '陈经理',
      managerPhone: '13800138006',
      execManager: '林经理',
      builder: '赵工',
      contractor: '瑞航建筑',
      supervisor: '监理公司',
      designer: '设计院',
      siteLeader: '现场负责人',
      siteLeaderPhone: '13800138007',
      riskLevel: '中',
      acceptanceDate: '2025-12-20',
      filingDate: '2025-12-15',
      note: '重点项目',
    }, 'submit')
    expect(await loadProjectForm(project.id)).toMatchObject({
      name: '珠江新城项目',
      contractName: '珠江新城精装合同',
      code: 'ZJXC-01',
      customerId: 'customer-ref',
      secondaryCustomerId: 'customer-second',
      region: '广州·天河',
      address: '珠江新城 1 号',
      operationType: '自营',
      type: '住宅精装',
      area: 12000,
      contractAmount: 30000000,
      overview: '两栋住宅',
      status: '施工中',
      startDate: '2026-01-01',
      plannedEnd: '2027-01-01',
      plannedDuration: 365,
      actualEnd: '',
      developerSupervisor: '甲方代表',
      manager: '陈经理',
      managerPhone: '13800138006',
      execManager: '林经理',
      builder: '赵工',
      contractor: '瑞航建筑',
      supervisor: '监理公司',
      designer: '设计院',
      siteLeader: '现场负责人',
      siteLeaderPhone: '13800138007',
      riskLevel: '中',
      acceptanceDate: '2025-12-20',
      filingDate: '2025-12-15',
      note: '重点项目',
      approvalStatus: 'submitted',
    })

    const target = await saveTargetCostForm({
      projectId: project.id,
      name: '开工基线',
      isBaseline: true,
      contractRevenue: 30000000,
      plannedProfit: 4500000,
      signedContractSum: 12000000,
      taxInclusiveTotal: 25500000,
      taxExclusiveTotal: 23394495.41,
      taxAmount: 2105504.59,
      note: '预算会审确认',
    }, 'submit')
    expect(await loadTargetCostForm(target.id)).toMatchObject({
      projectId: project.id,
      name: '开工基线',
      isBaseline: true,
      contractRevenue: 30000000,
      plannedProfit: 4500000,
      signedContractSum: 12000000,
      taxInclusiveTotal: 25500000,
      taxExclusiveTotal: 23394495.41,
      taxAmount: 2105504.59,
      note: '预算会审确认',
      status: 'submitted',
    })
  })

  it('切换目标成本基线在同一事务内取消旧基线并记录两条更新日志', async () => {
    const first = await saveTargetCostForm({
      projectId: 'project-ref',
      name: '投标预算',
      isBaseline: true,
    }, 'submit')
    const second = await saveTargetCostForm({
      projectId: 'project-ref',
      name: '开工基线',
      isBaseline: true,
    }, 'submit')

    expect(await mem.select(`
      SELECT id, is_baseline
      FROM target_costs
      ORDER BY created_at, id
    `)).toEqual([
      { id: first.id, is_baseline: 0 },
      { id: second.id, is_baseline: 1 },
    ])
    expect(await mem.select(`
      SELECT table_name, record_id, action
      FROM operation_logs
      WHERE table_name = 'target_costs'
      ORDER BY rowid
    `)).toEqual([
      { table_name: 'target_costs', record_id: first.id, action: 'create' },
      { table_name: 'target_costs', record_id: first.id, action: 'update' },
      { table_name: 'target_costs', record_id: second.id, action: 'create' },
    ])
  })

  it('附件只写 file_refs，可读取并记录创建日志', async () => {
    const project = await saveProjectForm({
      name: '附件项目',
      customerId: 'customer-ref',
      manager: '项目经理',
    }, 'submit', {
      add: [{
        fileName: '开票资料.pdf',
        filePath: 'documents/project/invoice.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        category: 'invoice',
        uploader: '测试员',
      }],
    })

    const [attachment] = await listFormAttachments('project', project.id)
    expect(attachment).toMatchObject({
      ownerType: 'project',
      ownerId: project.id,
      fileName: '开票资料.pdf',
      filePath: 'documents/project/invoice.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      category: 'invoice',
      uploader: '测试员',
      deletedAt: null,
    })
    expect(await mem.select(`SELECT * FROM file_payloads`)).toEqual([])

    expect(await mem.select(`
      SELECT action
      FROM operation_logs
      WHERE table_name = 'file_refs' AND record_id = ?
      ORDER BY rowid
    `, [attachment!.id])).toEqual([
      { action: 'create' },
    ])
  })

  it('附件失败会回滚头表与操作日志，不留下半张草稿', async () => {
    failFileInsert = true
    await expect(saveProjectForm({
      name: '事务项目',
      customerId: 'customer-ref',
      manager: '项目经理',
    }, 'submit', {
      add: [{
        fileName: '资料.pdf',
        category: 'invoice',
      }],
    })).rejects.toThrow('模拟附件写入失败')

    expect(await mem.select(`
      SELECT id FROM projects WHERE name = '事务项目'
    `)).toEqual([])
    expect(await mem.select(`
      SELECT id FROM operation_logs
      WHERE table_name IN ('projects', 'file_refs')
    `)).toEqual([])
  })

  it('客户与班组删除约束在领域事务内检查项目、合同和在册工人', async () => {
    await expect(deleteMasterDataRecord('customer', 'customer-ref'))
      .rejects
      .toThrow('活跃项目')
    await mem.execute(`
      INSERT INTO customers (id, name, contact)
      VALUES ('customer-contract-ref', '合同客户', '联系人')
    `)
    await mem.execute(`
      INSERT INTO contracts (id, name, kind, project_id, customer_id)
      VALUES ('contract-customer-ref', '施工合同', '施工', 'project-ref', 'customer-contract-ref')
    `)
    await expect(deleteMasterDataRecord('customer', 'customer-contract-ref'))
      .rejects
      .toThrow('活跃施工合同')

    await mem.execute(`
      INSERT INTO workers (id, name, crew_id)
      VALUES ('worker-crew-ref', '在册工人', 'crew-ref')
    `)
    await expect(deleteMasterDataRecord('crew', 'crew-ref'))
      .rejects
      .toThrow('在册工人')
  })

  it('六类头表共用软删除、恢复与日志边界', async () => {
    await mem.execute('INSERT INTO customers (id, name, contact, status) VALUES (\'customer-delete\', \'待删除客户\', \'联系人\', \'submitted\')')
    const customer = { id: 'customer-delete' }

    await deleteMasterDataRecord('customer', customer.id)
    expect(await loadCustomerForm(customer.id)).toBeNull()
    await restoreMasterDataRecord('customer', customer.id)
    expect((await loadCustomerForm(customer.id))?.name).toBe('待删除客户')
    expect(await mem.select(`
      SELECT action
      FROM operation_logs
      WHERE table_name = 'customers' AND record_id = ?
      ORDER BY rowid
    `, [customer.id])).toEqual([
      { action: 'delete' },
      { action: 'restore' },
    ])
  })
})
