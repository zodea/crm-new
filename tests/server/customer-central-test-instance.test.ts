import type { BusinessSession } from '../../server/utils/business-session'
import { describe, expect, it } from 'vitest'
import { CUSTOMER_WRITE_CAPABILITY } from '~/lib/customer/command-contract'
import { CustomerRepositoryProblem } from '~/lib/customer/repository'
import { parseCustomerCommandRequest } from '../../server/utils/customer-command-request'
import { createCustomerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { createCustomerReadTestInstance } from '../../server/utils/customer-read-test-instance'

const session: BusinessSession = {
  workspaceId: 'workspace-test',
  actorId: 'actor-test',
  capabilities: ['customer:list:read', CUSTOMER_WRITE_CAPABILITY, 'demo:read'],
}

describe('客户中央读写测试实例', () => {
  it('在 HTTP 边界拒绝畸形 draft 和附件变更', () => {
    expect(() => parseCustomerCommandRequest({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CUSTOMER_WRITE_CAPABILITY,
      commandId: 'malformed',
      baseVersion: null,
      action: 'save',
      draft: { name: 123 },
      attachments: { add: 'not-an-array' },
    })).toThrowError(CustomerRepositoryProblem)
  })

  it('以服务端 ID 建档，幂等执行，并由读取端回读同一客户', async () => {
    const commands = createCustomerCommandTestInstance({
      createId: () => 'customer-real-1',
      now: () => '2026-08-23T01:00:00.000Z',
    })
    const reads = createCustomerReadTestInstance(
      () => session.capabilities,
      id => commands.rows(id),
      id => commands.sourceVersion(id),
      undefined,
      undefined,
      undefined,
      () => session,
    )
    const before = await reads.list({}, 'session-a')
    const request = {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CUSTOMER_WRITE_CAPABILITY,
      commandId: 'command-create-1',
      baseVersion: null,
      action: 'save' as const,
      draft: {
        name: '中央客户',
        aliases: ['中央'],
        taxNo: '91440101CENTRAL',
        contact: '陈经理',
        contactPhone: '13800000000',
        status: 'active',
      },
      attachments: {},
    }

    const first = await commands.execute(request, session, 'session-a')
    const duplicate = await commands.execute(request, session, 'session-a')
    await expect(commands.execute({ ...request, draft: { ...request.draft, name: '异文客户' } }, session, 'session-a')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(commands.resolve(request.commandId, session, 'session-a')).toEqual({ outcome: 'applied', result: first })
    expect(commands.resolve('customer-unknown', session, 'session-a')).toEqual({ outcome: 'not-applied', commandId: 'customer-unknown' })
    await expect(commands.execute({ ...request, commandId: 'customer-unknown' }, session, 'session-a')).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const detail = await reads.detail('customer-real-1', {
      origin: 'real',
      includeDemo: 'false',
    }, 'session-a')

    expect(duplicate).toEqual(first)
    expect(detail.customer).toMatchObject({
      id: 'customer-real-1',
      name: '中央客户',
      dataOrigin: 'real',
    })
    expect(detail.meta).toMatchObject({ workspaceId: session.workspaceId, actorId: session.actorId, dataOrigin: 'real' })
    const ownerSource = detail.meta.sources.find(source => source.key === 'customers')!
    expect(ownerSource.state).toBe('readable')
    expect(ownerSource.sourceVersion).not.toBeNull()
    expect(ownerSource.sourceVersion).not.toBe(before.meta.sources.find(source => source.key === 'customers')!.sourceVersion)
    expect(detail.customer.updatedAt).toBe('2026-08-23T01:00:00.000Z')
  })

  it('更新要求匹配 baseVersion，成功后版本递增且刷新同一 ID', async () => {
    const commands = createCustomerCommandTestInstance({
      createId: () => 'customer-real-2',
      now: () => '2026-08-23T02:00:00.000Z',
    })
    const created = await commands.execute({
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CUSTOMER_WRITE_CAPABILITY,
      commandId: 'command-create-2',
      baseVersion: null,
      action: 'save',
      draft: { name: '待编辑客户', contact: '陈经理', status: 'active' },
      attachments: {},
    }, session)

    await expect(commands.execute({
      id: created.id,
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CUSTOMER_WRITE_CAPABILITY,
      commandId: 'command-stale',
      baseVersion: '0',
      action: 'save',
      draft: { id: created.id, name: '错误覆盖', contact: '陈经理', status: 'active' },
      attachments: {},
    }, session)).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'conflict' },
    })

    const updated = await commands.execute({
      id: created.id,
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CUSTOMER_WRITE_CAPABILITY,
      commandId: 'command-update',
      baseVersion: created.version,
      action: 'save',
      draft: { id: created.id, name: '已编辑客户', contact: '陈经理', status: 'active' },
      attachments: {},
    }, session)

    expect(updated).toMatchObject({ id: created.id, version: '2' })
    expect(commands.form(created.id, session).draft.name).toBe('已编辑客户')
  })

  it('服务端拒绝缺少联系人或超过九份有效附件的保存', async () => {
    const commands = createCustomerCommandTestInstance()
    const base = {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: CUSTOMER_WRITE_CAPABILITY,
      baseVersion: null,
      action: 'save' as const,
    }

    await expect(commands.execute({
      ...base,
      commandId: 'command-missing-contact',
      draft: { name: '缺联系人客户' },
      attachments: {},
    }, session)).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'validation-failed', fieldErrors: { contact: ['联系人为必填项'] } },
    })

    await expect(commands.execute({
      ...base,
      commandId: 'command-too-many-files',
      draft: { name: '附件过多客户', contact: '陈经理' },
      attachments: {
        add: Array.from({ length: 10 }, (_, index) => ({ fileName: `附件-${index + 1}.pdf`, fileSize: 1 })),
      },
    }, session)).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'validation-failed' },
    })
  })

  it('区分正式与测试来源，未授权时拒绝 demo 读取', async () => {
    const reads = createCustomerReadTestInstance(() => ['customer:list:read'])
    await expect(reads.list({ includeDemo: 'true' })).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    })
    await expect(reads.detail('customer_demo_001', {
      origin: 'demo',
      includeDemo: 'false',
    })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  })

  it('按稳定收款 ID 返回中央只读详情并保留客户来源', async () => {
    const reads = createCustomerReadTestInstance(() => ['customer:list:read', 'demo:read'])
    const detail = await reads.receipt('rr_mz0x1_0', {
      origin: 'demo',
      includeDemo: 'true',
      customerId: 'customer_demo_001',
    })

    expect(detail).toMatchObject({
      dataOrigin: 'demo',
      receipt: { receipt: { id: 'rr_mz0x1_0', label: 'SK-2026-001' } },
      customer: { id: 'customer_demo_001', label: '合和地产集团' },
    })
    await expect(reads.receipt('rr_mz0x1_0', {
      origin: 'demo',
      includeDemo: 'true',
      customerId: 'customer_demo_002',
    }))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(reads.receipt('rr_mz0x1_0', {
      origin: 'real',
      customerId: 'customer_demo_001',
    }))
      .rejects
      .toMatchObject({ problem: { code: 'relationship-mismatch' } })
  })

  it('没有客户读取能力时同时拒绝列表与详情', async () => {
    const reads = createCustomerReadTestInstance(() => ['demo:read'])
    await expect(reads.list({})).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(reads.detail('customer-real-1', { origin: 'real' }))
      .rejects
      .toMatchObject({ problem: { code: 'forbidden' } })
  })
})
