import type { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { describe, expect, it, vi } from 'vitest'
import { unavailablePayrollHostSection } from '~/lib/crew-worker/payroll-read'
import { managementFeeSource, projectManagementFees } from '~/lib/project/management-fee'
import { decodeProjectDetailRead } from '~/lib/project/repository'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import { createProjectReadTestInstance, PROJECT_READ_FIXTURE } from '../../server/utils/project-read-test-instance'

describe('project read resettable instance', () => {
  it('按测试会话隔离场景，避免并行浏览器互相污染', async () => {
    const instance = createProjectReadTestInstance()
    instance.reset('unavailable', 'session-a')
    instance.reset('forbidden', 'session-b')

    await expect(instance.list(undefined, 'session-a')).rejects.toMatchObject<
      Partial<ProjectRepositoryProblem>
    >({
      problem: { code: 'unavailable' },
    })
    await expect(instance.list(undefined, 'session-b')).rejects.toMatchObject<
      Partial<ProjectRepositoryProblem>
    >({
      problem: { code: 'forbidden' },
    })
    await expect(instance.list({ includeDemo: 'true' }, 'session-c')).resolves.toMatchObject({
      pagination: { total: 12 },
    })

    instance.reset('ready', 'session-a')
    await expect(instance.list({ includeDemo: 'true' }, 'session-a')).resolves.toMatchObject({
      pagination: { total: 12 },
    })
  })

  it('uses the same server capability for the global demo workspace', async () => {
    const demoWorkspace = createDemoWorkspaceTestInstance()
    const instance = createProjectReadTestInstance(sessionId => demoWorkspace.capabilities(sessionId))
    demoWorkspace.reset('forbidden', 'session-denied')

    await expect(instance.list({ includeDemo: 'true' }, 'session-ready')).resolves.toBeDefined()
    await expect(instance.list({ includeDemo: 'true' }, 'session-denied')).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    })
  })
  it('项目详情携管理簿实际同源证明，真实零与未接总额区分且 decoder 拒绝篡改源版本或越权明细', async () => {
    let capabilities = ['project:list:read', 'payroll:read']
    const row = { ...PROJECT_READ_FIXTURE[0]!, id: 'project-fee-owner', dataOrigin: 'real' as const, customerId: null, customerName: null, secondaryCustomerId: null, secondaryCustomerName: null }
    const resolve = vi.fn(async (scope: { kind: 'project', id: string }, _session: unknown, asOf: string) => ({ payrollActual: unavailablePayrollHostSection(scope, 'unavailable', '本夹具不提供额外P4投影'), managementFees: projectManagementFees(scope.id, 'real', asOf, managementFeeSource({ key: 'management-payroll', state: 'complete', sourceVersion: 'actual-empty-management-owner-v1', asOf, reasons: [], missingCount: 0, rows: [] }, asOf)) }))
    const instance = createProjectReadTestInstance(() => capabilities, () => [row], () => 'actual-project-owner-v1', undefined, async () => 0, async () => [], undefined, undefined, resolve)
    const read = await instance.detail(row.id, { origin: 'real' })
    expect(decodeProjectDetailRead(read).managementFees.actualCost).toMatchObject({ value: null, knownValue: '0.00', status: 'partial' })
    expect(read.managementFees.sources[0]!.actualCost).toMatchObject({ value: '0.00', participatingCount: 0 })
    expect(read.meta.sources.find(source => source.key === 'management-payroll')).toEqual({ key: 'management-payroll', state: 'readable', sourceVersion: 'actual-empty-management-owner-v1', asOf: read.asOf })
    const altered = structuredClone(read)
    altered.managementFees.sources[0]!.sourceVersion = 'unrelated-management-owner'
    expect(() => decodeProjectDetailRead(altered)).toThrow('实际来源证明')
    capabilities = ['project:list:read']
    const denied = await instance.detail(row.id, { origin: 'real' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(decodeProjectDetailRead(denied).item.project.id).toBe(row.id)
    expect(denied.managementFees.sources[0]).toMatchObject({ state: 'forbidden', rows: [], sourceVersion: null, actualCost: { value: null, knownValue: null } })
    const stolen = structuredClone(read)
    stolen.capabilities = ['project:list:read']
    stolen.meta.capabilities = ['project:list:read']
    expect(() => decodeProjectDetailRead(stolen)).toThrow('来源授权不一致')
  })

  it('管理费用读取期间撤权或切换项目事实时丢弃迟到的费用身份及金额', async () => {
    let capabilities = ['project:list:read', 'payroll:read']
    const row = { ...PROJECT_READ_FIXTURE[0]!, id: 'project-fee-late', dataOrigin: 'real' as const, customerId: null, customerName: null, secondaryCustomerId: null, secondaryCustomerName: null }
    const instance = createProjectReadTestInstance(() => capabilities, () => [row], () => 'project-owner-v1', undefined, async () => 0, async () => [], undefined, undefined, async (scope, _session, asOf) => {
      capabilities = ['project:list:read']
      return { payrollActual: unavailablePayrollHostSection(scope, 'unavailable', '夹具P4未接'), managementFees: projectManagementFees(scope.id, 'real', asOf) }
    })
    await expect(instance.detail(row.id, { origin: 'real' })).rejects.toMatchObject({ problem: { code: 'unavailable', message: '读取期间项目档案或权限已变化，请重新读取' } })
  })
})
