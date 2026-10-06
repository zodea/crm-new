import type { BusinessSession } from '../../server/utils/business-session'
import type { SupplierListSourceRow } from '~/lib/supplier/repository'
import { describe, expect, it, vi } from 'vitest'
import { SUPPLIER_WRITE_CAPABILITY } from '~/lib/supplier/command-contract'
import { SupplierRepositoryProblem } from '~/lib/supplier/repository'
import { parseSupplierCommandRequest } from '../../server/utils/supplier-command-request'
import { createSupplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'
import { createSupplierReadTestInstance } from '../../server/utils/supplier-read-test-instance'

const session: BusinessSession = {
  workspaceId: 'workspace-test',
  actorId: 'actor-test',
  capabilities: ['supplier:list:read', SUPPLIER_WRITE_CAPABILITY, 'demo:read'],
}

describe('分供方中央写入测试实例', () => {
  it('读取证据来自实际会话与同一上海业务日，翻页不换授权范围，跨日不写事实', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-23T15:59:59.000Z'))
      const commands = createSupplierCommandTestInstance({ createId: () => 'read-proof-supplier' })
      const reads = createSupplierReadTestInstance(() => session.capabilities, (id, asOf) => commands.rows(id, asOf), (id, asOf) => commands.sourceVersion(id, asOf))
      await commands.execute({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: SUPPLIER_WRITE_CAPABILITY, commandId: 'read-proof-create', baseVersion: null, action: 'save', draft: { name: '读取证据', supplierCategory: '材料供应商', contact: '联系人' }, attachments: {} }, session)
      const facts = structuredClone(commands.snapshot())
      const first = await reads.list({ page: 1, pageSize: 10 }, null, session)
      const clamped = await reads.list({ page: 99, pageSize: 10 }, null, session)
      expect(first.meta).toMatchObject({ workspaceId: session.workspaceId, actorId: session.actorId, dataOrigin: 'real', authorizedScope: { coverage: 'complete' } })
      expect(first.meta.sources.filter(source => source.state === 'readable').every(source => source.asOf === first.asOf)).toBe(true)
      expect(clamped.meta.authorizedScope).toEqual(first.meta.authorizedScope)
      expect(clamped.sourceVersion).toBe(first.sourceVersion)
      expect(clamped.pagination).toMatchObject({ requestedPage: 99, page: 1 })
      vi.setSystemTime(new Date('2026-08-23T16:00:00.000Z'))
      const nextDay = await reads.list({ page: 1, pageSize: 10 }, null, session)
      expect(nextDay.sourceVersion).not.toBe(first.sourceVersion)
      expect(nextDay.meta.sources.find(source => source.key === 'suppliers')?.sourceVersion).not.toBe(first.meta.sources.find(source => source.key === 'suppliers')?.sourceVersion)
      expect(nextDay.meta.authorizedScope).toEqual(first.meta.authorizedScope)
      expect(commands.snapshot()).toEqual(facts)
    }
    finally { vi.useRealTimers() }
  })
  it('独立保存劳务范围，省略保留、显式清空，并从列表与详情回读', async () => {
    const commands = createSupplierCommandTestInstance({ createId: () => 'labor-supplier' })
    const reads = createSupplierReadTestInstance(() => session.capabilities, id => commands.rows(id), id => commands.sourceVersion(id))
    const base = {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      action: 'save' as const,
      attachments: {},
      draft: { name: '劳务范围验证', supplierCategory: '其他', contact: '联系人', mainBusiness: '主营内容' },
    }
    const created = await commands.execute(parseSupplierCommandRequest({ ...base, commandId: 'labor-create', baseVersion: null, draft: { ...base.draft, laborScope: '石材安装\n楼梯铺贴' } }), session)
    expect(commands.form(created.id, session).draft.laborScope).toBe('石材安装\n楼梯铺贴')
    const updated = await commands.execute({ ...base, id: created.id, commandId: 'labor-omitted', baseVersion: created.version }, session)
    expect((await reads.list({ search: '楼梯铺贴' })).items[0]).toMatchObject({ laborScope: '石材安装\n楼梯铺贴', mainBusiness: '主营内容' })
    expect((await reads.detail(created.id, {})).supplier.laborScope).toBe('石材安装\n楼梯铺贴')
    await commands.execute({ ...base, id: created.id, commandId: 'labor-clear', baseVersion: updated.version, draft: { ...base.draft, laborScope: '' } }, session)
    expect(commands.form(created.id, session).draft.laborScope).toBe('')
    expect((await reads.list({ search: '楼梯铺贴' })).items).toEqual([])
    const imported = { ...commands.rows()[0]!, id: 'qualified-import', credentialStatus: 'qualified' }
    commands.prepareImportedSuppliers([imported]).commit()
    await commands.execute({ ...base, id: imported.id, commandId: 'labor-qualified', baseVersion: '1', draft: { ...base.draft, laborScope: '幕墙安装' } }, session)
    // 旧人工态没有供应商级凭证与真实原件时不能继续冒充合格；有效人工结论另由证照完整旅程验证。
    expect(commands.rows().find(row => row.id === imported.id)).toMatchObject({ laborScope: '幕墙安装', credentialStatus: 'incomplete' })
  })

  it('在 HTTP 边界拒绝畸形 draft', () => {
    expect(() => parseSupplierCommandRequest({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'malformed',
      baseVersion: null,
      action: 'save',
      draft: { name: 123 },
      attachments: {},
    })).toThrowError(SupplierRepositoryProblem)
  })

  it('以服务端 ID 建档、幂等执行，并暴露中央读取行', async () => {
    const commands = createSupplierCommandTestInstance({
      createId: () => 'supplier-real-1',
      now: () => '2026-08-23T03:00:00.000Z',
    })
    const request = {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'supplier-create-1',
      baseVersion: null,
      action: 'save' as const,
      draft: {
        name: '中央分供方',
        aliases: ['中央供应'],
        uniqueCode: 'SUP-CENTRAL-1',
        taxNo: '91440101CENTRAL',
        supplierCategory: '材料供应商',
        contact: '陈经理',
        contactPhone: '13800000000',
        approvalStatus: 'active',
      },
      attachments: {},
    }

    const first = await commands.execute(request, session, 'session-a')
    const duplicate = await commands.execute(request, session, 'session-a')

    expect(duplicate).toEqual(first)
    await expect(commands.execute({ ...request, draft: { ...request.draft, name: '同键错误覆盖' } }, session, 'session-a')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(commands.rows('session-a')).toEqual([
      expect.objectContaining({
        id: 'supplier-real-1',
        name: '中央分供方',
        dataOrigin: 'real',
        credentialStatus: 'incomplete',
      }),
    ])
    // 原断言保护首写只推进一次真实修订；派生业务日也是读取来源版本的独立维度。
    expect(commands.snapshot('session-a').sourceVersion).toBe(1)
    const version = commands.sourceVersion('session-a')
    expect(version).toContain('2026-08-23')
    expect(commands.sourceVersion('session-a')).toBe(version)
  })

  it('由同一中央读取端回读正式主档，并让演示四类事实保持真实来源', async () => {
    const commands = createSupplierCommandTestInstance({
      createId: () => 'supplier-real-read',
      now: () => '2026-08-23T03:30:00.000Z',
    })
    const reads = createSupplierReadTestInstance(
      () => session.capabilities,
      id => commands.rows(id),
      id => commands.sourceVersion(id),
    )
    await commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'supplier-create-read',
      baseVersion: null,
      action: 'save',
      draft: { name: '正式分供方', supplierCategory: '材料供应商', contact: '陈经理' },
      attachments: {},
    }, session, 'session-read')

    const formal = await reads.detail('supplier-real-read', { origin: 'real' }, 'session-read')
    const demo = await reads.detail('sup_demo_004', { origin: 'demo', includeDemo: 'true' }, 'session-read')

    expect(formal).toMatchObject({
      dataOrigin: 'real',
      supplier: { id: 'supplier-real-read', name: '正式分供方' },
      summary: {
        // The old assertion protected empty authorized facts and stable drilldowns. Unconnected sources cannot prove zero.
        contractAmount: { value: '0.00', knownValue: '0.00', participatingCount: 0, drilldown: { kind: 'entity-subview', variant: 'contracts', subject: { id: 'supplier-real-read' }, filters: { dataOrigin: 'real' } } },
        settlementAmount: { value: null, knownValue: null, participatingCount: null, missingCount: null, drilldown: { variant: 'settlements' } },
        invoiceAmount: { value: null, knownValue: null, participatingCount: null, missingCount: null, drilldown: { variant: 'invoices' } },
        paymentAmount: { value: null, knownValue: null, participatingCount: null, missingCount: null, drilldown: { variant: 'payments' } },
      },
      meta: { authorizedScope: { coverage: 'complete' }, sources: expect.arrayContaining([{ key: 'invoices', state: 'unavailable', sourceVersion: null, asOf: null }]) },
    })
    expect(demo.summary).toMatchObject({
      contractAmount: { value: '261250.00' },
      settlementAmount: { value: '0.00' },
      invoiceAmount: { value: '12380.00' },
      paymentAmount: { value: '101138.00' },
      payableAmount: { value: '160112.00', drilldown: null },
    })
    expect(demo.payments.map(item => item.application.id)).toEqual(['pa_demo_sup004_1', 'pa_demo_sup004_2'])
  })

  it('更新要求匹配 baseVersion，且正式保存校验三个必填字段', async () => {
    const commands = createSupplierCommandTestInstance({
      createId: () => 'supplier-real-2',
      now: () => '2026-08-23T04:00:00.000Z',
    })

    await expect(commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'supplier-invalid',
      baseVersion: null,
      action: 'save',
      draft: { name: '缺字段分供方' },
      attachments: {},
    }, session)).rejects.toMatchObject<SupplierRepositoryProblem>({
      problem: {
        code: 'validation-failed',
        fieldErrors: {
          supplierCategory: ['分供方类别为必填项'],
          contact: ['主要联系人为必填项'],
        },
      },
    })

    const created = await commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'supplier-create-2',
      baseVersion: null,
      action: 'save',
      draft: { name: '待编辑分供方', supplierCategory: '专业分包商', contact: '王经理' },
      attachments: {},
    }, session)

    await expect(commands.execute({
      id: created.id,
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'supplier-stale',
      baseVersion: '0',
      action: 'save',
      draft: { id: created.id, name: '错误覆盖', supplierCategory: '专业分包商', contact: '王经理' },
      attachments: {},
    }, session)).rejects.toMatchObject<SupplierRepositoryProblem>({ problem: { code: 'conflict' } })

    const updated = await commands.execute({
      id: created.id,
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: SUPPLIER_WRITE_CAPABILITY,
      commandId: 'supplier-update',
      baseVersion: created.version,
      action: 'save',
      draft: { id: created.id, name: '已编辑分供方', supplierCategory: '专业分包商', contact: '王经理' },
      attachments: {},
    }, session)

    expect(updated).toMatchObject({ id: created.id, version: '2' })
    expect(commands.form(created.id, session).draft.name).toBe('已编辑分供方')
  })

  it('导入 lookup 返回完整正式身份集合，不被列表 100 条分页截断', async () => {
    const rows = Array.from({ length: 101 }, (_, index): SupplierListSourceRow => ({
      dataOrigin: 'real',
      id: `supplier-${index + 1}`,
      name: `正式分供方 ${index + 1}`,
      aliases: [],
      externalRef: '',
      uniqueCode: '',
      taxNo: '',
      businessType: '',
      supplierCategory: '其他',
      rating: '',
      legalRep: '',
      registeredCapital: null,
      registeredDate: null,
      address: '',
      taxpayerType: '',
      mainBusiness: '',
      invoiceName: '',
      invoiceAddress: '',
      bank: '',
      bankAccount: '',
      phone: '',
      contact: '',
      contactPhone: '',
      contactTitle: '',
      credentialStatus: 'incomplete',
      note: '',
      updatedAt: '2026-08-27T00:00:00.000Z',
    }))
    const reads = createSupplierReadTestInstance(
      () => session.capabilities,
      () => rows,
      () => 'supplier-command-101',
    )

    const options = await reads.formalOptions('session-many')
    expect(options).toHaveLength(101)
    expect(options.at(-1)).toEqual({ id: 'supplier-101', name: '正式分供方 101', aliases: [] })
  })
})
