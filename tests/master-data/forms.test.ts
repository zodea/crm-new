import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import {
  deleteMasterDataRecord,
  listFormAttachments,
  loadCrewForm,
  loadCustomerForm,
  loadProjectForm,
  loadSupplierForm,
  loadTargetCostForm,
  loadWorkerForm,
  removeFormAttachment,
  restoreFormAttachment,
  restoreMasterDataRecord,
  saveCrewForm,
  saveCustomerForm,
  saveProjectForm,
  saveSupplierForm,
  saveTargetCostForm,
  saveWorkerForm,
} from '~/lib/master-data/forms'
import { useCrewStore } from '~/stores/crew'
import { useCustomerStore } from '~/stores/customer'
import { useProjectStore } from '~/stores/project'
import { useSupplierStore } from '~/stores/supplier'
import { useTargetCostStore } from '~/stores/target-cost'
import { useWorkerStore } from '~/stores/worker'
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
  it('六类 Pinia store 都通过统一 action 保存并刷新响应式状态', async () => {
    const supplierStore = useSupplierStore()
    const customerStore = useCustomerStore()
    const crewStore = useCrewStore()
    const workerStore = useWorkerStore()
    const projectStore = useProjectStore()
    const targetCostStore = useTargetCostStore()

    const supplier = await supplierStore.saveForm({
      name: 'Store 分供方',
      supplierCategory: '材料供应商',
      contact: '联系人',
    }, 'submit')
    const customer = await customerStore.save({
      name: 'Store 客户',
      contact: '联系人',
    }, 'submit')
    const crew = await crewStore.save({
      name: 'Store 班组',
      trade: '泥水',
      contactName: '班组长',
      contactPhone: '13800138000',
    }, 'submit')
    const worker = await workerStore.save({
      name: 'Store 工人',
      phone: '13800138001',
      bankName: '建设银行',
      bankAccount: '62270001',
      trade: '泥水',
      crewId: crew.id,
      currentProjectId: 'project-ref',
    }, 'submit')
    const project = await projectStore.saveForm({
      name: 'Store 项目',
      customerId: customer.id,
      manager: '项目经理',
    }, 'submit')
    const targetCost = await targetCostStore.save({
      name: 'Store 目标成本',
      projectId: project.id,
    }, 'submit')

    expect(supplierStore.byId(supplier.id)?.name).toBe('Store 分供方')
    expect(customerStore.current?.name).toBe('Store 客户')
    expect(crewStore.current?.name).toBe('Store 班组')
    expect(workerStore.current?.name).toBe('Store 工人')
    expect(projectStore.byId(project.id)?.customerId).toBe(customer.id)
    expect(targetCostStore.current?.projectId).toBe(project.id)
    expect(customerStore.revision).toBe(1)
    expect(crewStore.revision).toBe(1)
    expect(workerStore.revision).toBe(1)
    expect(targetCostStore.revision).toBe(1)
    expect(worker.id).toBeTruthy()
    expect(targetCost.id).toBeTruthy()
  })

  it('草稿跳过提交必填校验，六类头表都能保存后重新载入', async () => {
    const supplier = await saveSupplierForm({
      name: '',
      supplierCategory: '',
      contact: '',
    }, 'draft')
    const customer = await saveCustomerForm({
      name: '',
      contact: '',
    }, 'draft')
    const crew = await saveCrewForm({
      name: '',
      trade: '',
      contactName: '',
      contactPhone: '',
    }, 'draft')
    const worker = await saveWorkerForm({
      name: '',
      phone: '',
      bankName: '',
      bankAccount: '',
      trade: '',
    }, 'draft')
    const project = await saveProjectForm({
      name: '',
      customerId: null,
      manager: '',
    }, 'draft')
    const targetCost = await saveTargetCostForm({
      projectId: null,
      name: '',
    }, 'draft')

    expect((await loadSupplierForm(supplier.id))?.approvalStatus).toBe('draft')
    expect((await loadCustomerForm(customer.id))?.status).toBe('draft')
    expect((await loadCrewForm(crew.id))?.status).toBe('draft')
    expect((await loadWorkerForm(worker.id))?.status).toBe('draft')
    expect((await loadProjectForm(project.id))?.approvalStatus).toBe('draft')
    expect(await loadTargetCostForm(targetCost.id)).toMatchObject({
      projectId: null,
      status: 'draft',
    })
  })

  it('提交逐类校验必填、真实关系与非负数，不接受名称假装外键', async () => {
    await expect(saveSupplierForm({
      name: '测试分供方',
      supplierCategory: '',
      contact: '',
    }, 'submit')).rejects.toThrow('分供方类别')
    await expect(saveCustomerForm({
      name: '测试客户',
      contact: '',
    }, 'submit')).rejects.toThrow('联系人')
    await expect(saveCrewForm({
      name: '测试班组',
      trade: '泥水',
      contactName: '班组长',
      contactPhone: '',
    }, 'submit')).rejects.toThrow('联系电话')
    await expect(saveCrewForm({
      name: '引用班组',
      trade: '木工',
      contactName: '另一班组长',
      contactPhone: '13800138009',
    }, 'submit')).rejects.toThrow('班组名称已存在')
    await expect(saveWorkerForm({
      name: '张三',
      phone: '13800138001',
      bankName: '建设银行',
      bankAccount: '62270000',
      trade: '泥水',
      crewId: '不存在班组',
    }, 'submit')).rejects.toThrow('所属班组不存在')
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
    await expect(saveWorkerForm({
      name: '不可见项目工人',
      phone: '13800138002',
      bankName: '建设银行',
      bankAccount: '62270002',
      trade: '泥水',
      currentProjectId: 'project-ref',
    }, 'submit')).rejects.toThrow('当前项目不存在或已删除')
    await expect(saveTargetCostForm({
      projectId: 'project-ref',
      name: '不可见项目目标',
    }, 'submit')).rejects.toThrow('项目不存在或已删除')
  })

  it('六类表单的全部可编辑标量字段按真实 ID 写入并完整回显', async () => {
    const supplier = await saveSupplierForm({
      name: '华南材料有限公司',
      aliases: ['华南材料', '华材'],
      externalRef: 'OLD-S-001',
      uniqueCode: 'SUP-001',
      taxNo: '914400000000000001',
      businessType: '材料',
      supplierCategory: '材料供应商',
      rating: 'A',
      legalRep: '李总',
      registeredCapital: 1000,
      registeredDate: '2020-01-02',
      address: '广州市白云区',
      taxpayerType: '一般纳税人',
      mainBusiness: '建筑材料',
      invoiceName: '华南材料有限公司',
      invoiceAddress: '广州市白云区 1 号',
      bank: '建设银行广州支行',
      bankAccount: '44000001',
      phone: '020-88880001',
      contact: '李经理',
      contactPhone: '13800138001',
      contactTitle: '销售经理',
      note: '长期合作',
    }, 'submit')
    expect(await loadSupplierForm(supplier.id)).toMatchObject({
      name: '华南材料有限公司',
      aliases: ['华南材料', '华材'],
      externalRef: 'OLD-S-001',
      uniqueCode: 'SUP-001',
      taxNo: '914400000000000001',
      businessType: '材料',
      supplierCategory: '材料供应商',
      rating: 'A',
      legalRep: '李总',
      registeredCapital: 1000,
      registeredDate: '2020-01-02',
      address: '广州市白云区',
      taxpayerType: '一般纳税人',
      mainBusiness: '建筑材料',
      invoiceName: '华南材料有限公司',
      invoiceAddress: '广州市白云区 1 号',
      bank: '建设银行广州支行',
      bankAccount: '44000001',
      phone: '020-88880001',
      contact: '李经理',
      contactPhone: '13800138001',
      contactTitle: '销售经理',
      note: '长期合作',
      approvalStatus: 'submitted',
    })

    const customer = await saveCustomerForm({
      name: '岭南建设单位',
      aliases: ['岭南建设', 'LNJS'],
      taxNo: '914400000000000002',
      legalRep: '王总',
      registeredAddress: '广州市越秀区',
      invoiceName: '岭南建设单位',
      bank: '工商银行广州支行',
      bankAccount: '44000002',
      contact: '王经理',
      contactPhone: '13800138002',
      note: '重点客户',
    }, 'submit')
    expect(await loadCustomerForm(customer.id)).toMatchObject({
      name: '岭南建设单位',
      aliases: ['岭南建设', 'LNJS'],
      taxNo: '914400000000000002',
      legalRep: '王总',
      registeredAddress: '广州市越秀区',
      invoiceName: '岭南建设单位',
      bank: '工商银行广州支行',
      bankAccount: '44000002',
      contact: '王经理',
      contactPhone: '13800138002',
      note: '重点客户',
      status: 'submitted',
    })

    const crew = await saveCrewForm({
      name: '精装一班',
      trade: '泥水',
      capabilityTrades: ['防水工'],
      capabilityItems: ['墙砖铺贴', '地砖铺贴'],
      contactName: '赵班长',
      contactPhone: '13800138003',
      defaultPayRatio: 0.92,
      rentSubsidyEnabled: true,
      rentSubsidyPrice: 8,
      mgmtFeeEnabled: true,
      mgmtFeePrice: 2.5,
      assignmentLevel: 'worker',
      note: '个人粒度指派',
    }, 'submit')
    expect(await loadCrewForm(crew.id)).toMatchObject({
      name: '精装一班',
      trade: '泥水',
      capabilityTrades: ['防水工'],
      capabilityItems: ['墙砖铺贴', '地砖铺贴'],
      contactName: '赵班长',
      contactPhone: '13800138003',
      defaultPayRatio: 0.92,
      rentSubsidyEnabled: true,
      rentSubsidyPrice: 8,
      mgmtFeeEnabled: true,
      mgmtFeePrice: 2.5,
      assignmentLevel: 'worker',
      note: '个人粒度指派',
      status: 'submitted',
    })

    const worker = await saveWorkerForm({
      name: '张三',
      gender: '男',
      idCard: '440101199001010011',
      phone: '13800138004',
      hometown: '广东梅州',
      emergencyContact: '张父',
      emergencyPhone: '13800138005',
      bankName: '农业银行广州支行',
      bankAccount: '6228480001',
      bankCode: '103581000001',
      trade: '泥水',
      capabilityTrades: ['防水工'],
      capabilityItems: ['墙砖铺贴'],
      skillLevel: '高级',
      dailyWage: 420,
      crewId: 'crew-ref',
      currentProjectId: 'project-ref',
      familyGroupId: 'family-001',
      projectStatus: '在场',
      entryDate: '2026-07-01',
      exitDate: '',
      safetyEducation: true,
      note: '证件齐全',
    }, 'submit')
    expect(await loadWorkerForm(worker.id)).toMatchObject({
      name: '张三',
      gender: '男',
      idCard: '440101199001010011',
      phone: '13800138004',
      hometown: '广东梅州',
      emergencyContact: '张父',
      emergencyPhone: '13800138005',
      bankName: '农业银行广州支行',
      bankAccount: '6228480001',
      bankCode: '103581000001',
      trade: '泥水',
      capabilityTrades: ['防水工'],
      capabilityItems: ['墙砖铺贴'],
      skillLevel: '高级',
      dailyWage: 420,
      crewId: 'crew-ref',
      currentProjectId: 'project-ref',
      familyGroupId: 'family-001',
      projectStatus: '在场',
      entryDate: '2026-07-01',
      exitDate: '',
      safetyEducation: true,
      note: '证件齐全',
      status: 'submitted',
    })

    const project = await saveProjectForm({
      name: '珠江新城项目',
      contractName: '珠江新城精装合同',
      code: 'ZJXC-01',
      customerId: 'customer-ref',
      secondaryCustomerId: customer.id,
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
      secondaryCustomerId: customer.id,
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

  it('普通分供方表单保存不会覆盖独立纳税人核验留痕', async () => {
    const supplier = await saveSupplierForm({
      name: '核验留痕分供方',
      supplierCategory: '材料供应商',
      taxpayerType: '一般纳税人',
      contact: '陈经理',
    }, 'submit')
    await mem.execute(
      `UPDATE suppliers
       SET taxpayer_verification_status = 'confirmed_general',
           taxpayer_verification_source = '广东省电子税务局',
           taxpayer_verified_at = '2026-07-30T01:02:03.000Z',
           taxpayer_verification_note = '官网人工核验'
       WHERE id = ?`,
      [supplier.id],
    )

    const draft = await loadSupplierForm(supplier.id)
    expect(draft).not.toBeNull()
    await saveSupplierForm({
      ...draft!,
      contact: '更新后的联系人',
      taxpayerVerificationStatus: 'not_checked',
      taxpayerVerificationSource: '',
      taxpayerVerifiedAt: null,
      taxpayerVerificationNote: '',
    }, 'submit')

    const [row] = await mem.select<{
      taxpayer_verification_status: string
      taxpayer_verification_source: string
      taxpayer_verified_at: string | null
      taxpayer_verification_note: string
    }>(
      `SELECT taxpayer_verification_status, taxpayer_verification_source,
              taxpayer_verified_at, taxpayer_verification_note
       FROM suppliers WHERE id = ?`,
      [supplier.id],
    )
    expect(row).toEqual({
      taxpayer_verification_status: 'confirmed_general',
      taxpayer_verification_source: '广东省电子税务局',
      taxpayer_verified_at: '2026-07-30T01:02:03.000Z',
      taxpayer_verification_note: '官网人工核验',
    })
  })

  it('分供方表单只写脱敏审计，关键工商字段变化使人工结论失效', async () => {
    const supplier = await saveSupplierForm({
      name: '表单敏感分供方',
      supplierCategory: '材料供应商',
      contact: '联系人',
      taxNo: 'FORM-SECRET-TAX',
      bankAccount: 'FORM-SECRET-ACCOUNT',
    }, 'submit')
    await mem.execute(`
      UPDATE suppliers
      SET credential_status = 'qualified',
          credential_reviewed_at = '2026-07-30T08:00:00.000Z',
          credential_review_note = '人工通过'
      WHERE id = ?
    `, [supplier.id])

    const draft = await loadSupplierForm(supplier.id)
    await saveSupplierForm({
      ...draft!,
      taxNo: 'FORM-SECRET-TAX-UPDATED',
    }, 'submit')

    expect(await mem.select(`
      SELECT credential_status, credential_reviewed_at, credential_review_note
      FROM suppliers WHERE id = ?
    `, [supplier.id])).toEqual([{
      credential_status: 'incomplete',
      credential_reviewed_at: null,
      credential_review_note: '',
    }])
    expect(await mem.select(`
      SELECT id FROM operation_logs
      WHERE table_name = 'suppliers' AND record_id = ?
    `, [supplier.id])).toEqual([])
    expect(JSON.stringify(await mem.select(`
      SELECT action, outcome, source_category, changed_fields, note_present
      FROM supplier_audits WHERE supplier_id = ?
      ORDER BY rowid
    `, [supplier.id]))).not.toMatch(/FORM-SECRET|人工通过/)
    expect(await mem.select(`
      SELECT action, source_category, changed_fields
      FROM supplier_audits WHERE supplier_id = ?
      ORDER BY rowid
    `, [supplier.id])).toEqual([
      {
        action: 'create',
        source_category: 'form',
        changed_fields: expect.any(String),
      },
      {
        action: 'update',
        source_category: 'form',
        changed_fields: '["tax_no"]',
      },
    ])
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

  it('附件只写 file_refs，支持读取、软删、恢复并记录日志', async () => {
    const customer = await saveCustomerForm({
      name: '附件客户',
      contact: '联系人',
    }, 'submit', {
      add: [{
        fileName: '开票资料.pdf',
        filePath: 'documents/customer/invoice.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        category: 'invoice',
        uploader: '测试员',
      }],
    })

    const [attachment] = await listFormAttachments('customer', customer.id)
    expect(attachment).toMatchObject({
      ownerType: 'customer',
      ownerId: customer.id,
      fileName: '开票资料.pdf',
      filePath: 'documents/customer/invoice.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      category: 'invoice',
      uploader: '测试员',
      deletedAt: null,
    })
    expect(await mem.select(`SELECT * FROM file_payloads`)).toEqual([])

    await removeFormAttachment('customer', customer.id, attachment!.id)
    expect(await listFormAttachments('customer', customer.id)).toEqual([])
    const [deletedAttachment] = await listFormAttachments('customer', customer.id, true)
    expect(deletedAttachment?.deletedAt).not.toBeNull()

    await restoreFormAttachment('customer', customer.id, attachment!.id)
    expect(await listFormAttachments('customer', customer.id)).toHaveLength(1)
    expect(await mem.select(`
      SELECT action
      FROM operation_logs
      WHERE table_name = 'file_refs' AND record_id = ?
      ORDER BY rowid
    `, [attachment!.id])).toEqual([
      { action: 'create' },
      { action: 'delete' },
      { action: 'restore' },
    ])
  })

  it('附件失败会回滚头表与操作日志，不留下半张草稿', async () => {
    failFileInsert = true
    await expect(saveCustomerForm({
      name: '事务客户',
      contact: '联系人',
    }, 'submit', {
      add: [{
        fileName: '资料.pdf',
        category: 'invoice',
      }],
    })).rejects.toThrow('模拟附件写入失败')

    expect(await mem.select(`
      SELECT id FROM customers WHERE name = '事务客户'
    `)).toEqual([])
    expect(await mem.select(`
      SELECT id FROM operation_logs
      WHERE table_name IN ('customers', 'file_refs')
    `)).toEqual([])
  })

  it('客户附件最多保留 9 个，超限时整笔事务回滚', async () => {
    const customer = await saveCustomerForm({
      name: '九附件客户',
      contact: '联系人',
    }, 'submit', {
      add: Array.from({ length: 9 }, (_, index) => ({
        fileName: `附件-${index + 1}.pdf`,
        filePath: `documents/customer/${index + 1}.pdf`,
      })),
    })

    await expect(saveCustomerForm({
      id: customer.id,
      name: '九附件客户',
      contact: '联系人',
    }, 'save', {
      add: [{ fileName: '第十个附件.pdf' }],
    })).rejects.toThrow('客户附件最多 9 个')
    expect(await listFormAttachments('customer', customer.id)).toHaveLength(9)
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
    const customer = await saveCustomerForm({
      name: '待删除客户',
      contact: '联系人',
    }, 'submit')

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
      { action: 'create' },
      { action: 'delete' },
      { action: 'restore' },
    ])
  })
})
