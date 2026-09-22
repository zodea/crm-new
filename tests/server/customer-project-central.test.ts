import type { ProjectFormDraft } from '~/lib/master-data/forms'
import { afterEach, describe, expect, it } from 'vitest'
import { decodeCustomerDetailRead } from '~/lib/customer/repository'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { customerCommandTestInstance as customers } from '../../server/utils/customer-command-test-instance'
import { customerReadTestInstance as customerReads } from '../../server/utils/customer-read-test-instance'
import { projectCommandTestInstance as projects } from '../../server/utils/project-command-test-instance'
import { projectReadTestInstance as projectReads } from '../../server/utils/project-read-test-instance'

const session = resolveBusinessSession()
const scope = 'customer-project-unit-424'
let command = 0
const envelope = () => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId: `cp-${++command}`, baseVersion: null, action: 'save' as const, attachments: {} })
const customer = (name = '同名合成客户') => customers.execute({ ...envelope(), requiredCapability: 'customer:write', draft: { name, contact: '合成联系人' } }, session, scope)
const project = (draft: ProjectFormDraft) => projects.execute({ ...envelope(), requiredCapability: 'project:write', draft: { name: '合成项目', manager: '合成经理', ...draft } }, session, scope)
const detail = async (id: string, origin: 'real' | 'demo' = 'real') => decodeCustomerDetailRead(await customerReads.detail(id, { origin, includeDemo: String(origin === 'demo') }, scope))

afterEach(() => {
  customers.reset(scope)
  projects.reset(scope)
  customerReads.reset('ready', scope)
  projectReads.reset('ready', scope)
})

describe('中央项目事实→客户关联回读', () => {
  it('同名不同 ID、主次客户与同项目双重角色按稳定身份去重，列表与数量一致', async () => {
    const a = await customer()
    const b = await customer()
    const c = await customer()
    const first = await project({ customerId: a.id, secondaryCustomerId: b.id })
    const both = await project({ customerId: a.id, secondaryCustomerId: a.id })
    const readA = await detail(a.id)
    const readB = await detail(b.id)
    expect(readA.projects.map(row => [row.project.id, row.relationRole])).toEqual([[first.id, '主客户'], [both.id, '主客户']])
    expect(readA.summary.projectCount).toBe(2)
    expect(readB.projects.map(row => [row.project.id, row.relationRole])).toEqual([[first.id, '次客户']])
    expect(readB.summary.projectCount).toBe(1)
    expect((await detail(c.id)).summary.projectCount).toBe(0)
    expect((await detail(c.id)).projects).toEqual([])
    expect((await projectReads.list({ includeDemo: 'false', search: '合成项目' }, scope)).items.map(row => row.project.id)).toEqual(expect.arrayContaining([first.id, both.id]))
  })

  it('项目换主次客户后旧客户移除、新客户出现，客户改名保持项目身份且项目标签重新回读', async () => {
    const a = await customer('原客户')
    const b = await customer('新客户')
    const p = await project({ customerId: a.id })
    const before = await detail(a.id)
    await projects.execute({ ...envelope(), id: p.id, baseVersion: p.version, requiredCapability: 'project:write', draft: { ...projects.form(p.id, session, scope).draft, customerId: b.id, secondaryCustomerId: null } }, session, scope)
    expect((await detail(a.id)).projects).toEqual([])
    const changed = await detail(b.id)
    expect(changed.projects[0]?.project.id).toBe(p.id)
    expect(changed.sourceVersion).not.toBe(before.sourceVersion)
    await customers.execute({ ...envelope(), id: b.id, baseVersion: b.version, requiredCapability: 'customer:write', draft: { name: '客户改名后', contact: '合成联系人' } }, session, scope)
    expect((await detail(b.id)).projects[0]?.project.id).toBe(p.id)
    const projectDetail = await projectReads.detail(p.id, { origin: 'real', includeDemo: 'false' }, scope)
    expect(projectDetail.item.customer).toMatchObject({ id: b.id, label: '客户改名后' })
  })

  it.each(['forbidden', 'unavailable'] as const)('整个项目源 %s 不泄露旧身份或假零，不阻断客户列表，恢复后同身份回读', async (scenario) => {
    const a = await customer()
    const p = await project({ customerId: a.id })
    expect((await detail(a.id)).projects).toHaveLength(1)
    projectReads.reset(scenario, scope)
    const failed = await detail(a.id)
    expect(failed.projectsProblem?.code).toBe(scenario)
    expect(failed.summary.projectCount).toBeNull()
    expect(failed.projects).toEqual([])
    expect(JSON.stringify(failed)).not.toContain(p.id)
    expect((await customerReads.list({ search: '同名合成客户' }, scope)).items[0]?.customer.id).toBe(a.id)
    projectReads.reset('ready', scope)
    expect((await detail(a.id)).projects[0]?.project.id).toBe(p.id)
  })

  it('正式关联不借用演示客户、同一来源跨会话不串数据，受限演示项目不暴露身份和数量', async () => {
    const a = await customer()
    const p = await project({ customerId: a.id, secondaryCustomerId: 'customer_demo_001' })
    expect((await detail(a.id)).projects[0]?.project.id).toBe(p.id)
    expect(JSON.stringify(await detail('customer_demo_001', 'demo'))).not.toContain(p.id)
    await expect(customerReads.detail(a.id, { origin: 'demo', includeDemo: 'true' }, scope)).rejects.toMatchObject({ problem: { code: 'relationship-mismatch' } })
    await expect(customerReads.detail(a.id, { origin: 'real' }, 'other-customer-project-424')).rejects.toMatchObject({ problem: { code: 'not-found' } })
    const forbidden = await detail('customer_demo_003', 'demo')
    expect(forbidden.projects).toEqual([])
    expect(forbidden.summary.projectCount).toBe(0)
    expect(JSON.stringify(forbidden.projects)).not.toContain('proj_demo_003')
  })
})
