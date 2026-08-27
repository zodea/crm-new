import type { BusinessSession } from '../../server/utils/business-session'
import type { SupplierListSourceRow } from '~/lib/supplier/repository'
import { describe, expect, it } from 'vitest'
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
    expect(commands.rows('session-a')).toEqual([
      expect.objectContaining({
        id: 'supplier-real-1',
        name: '中央分供方',
        dataOrigin: 'real',
        credentialStatus: 'incomplete',
      }),
    ])
    expect(commands.sourceVersion('session-a')).toBe('supplier-command-1')
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
        contractAmount: { value: '0.00', drilldown: { entity: 'contract' } },
        settlementAmount: { value: '0.00', drilldown: { entity: 'settlement' } },
        invoiceAmount: { value: '0.00', drilldown: { entity: 'invoice' } },
        paymentAmount: { value: '0.00', drilldown: { entity: 'payment-record' } },
      },
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
