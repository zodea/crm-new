import type { DomainRepositories } from '~/plugins/repositories'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPayrollDetailRead } from '~/lib/payroll/platform-read'
import { createTabRestoreValidator } from '~/lib/tabs/restore-target'
import { payrollDetailFixture } from '../helpers/payroll-central-read-fixture'

vi.mock('~/lib/payroll/platform-read', () => ({ loadPayrollDetailRead: vi.fn() }))
const read = vi.mocked(loadPayrollDetailRead)
const repositories = { payroll: {} } as DomainRepositories
const path = '/subcontract/payroll/wage-a?origin=real&project=project-a&month=2026-08&crew=crew-a&status=released&format=C2&deleted=deleted'
const descriptor = { key: '/subcontract/payroll/wage-a', title: '旧工资名', fullPath: path, origin: 'real' as const, targetVersion: 1, sourceVersion: 'old', updatedAt: 1, closable: true }
beforeEach(() => {
  read.mockReset()
  read.mockResolvedValue(payrollDetailFixture())
})
describe('工资只读页签恢复', () => {
  it('重新授权中央工资并保同项目、月份、班组及完整筛选', async () => {
    const restore = createTabRestoreValidator({ repositories, capabilities: () => ['payroll:read'], includeDemo: () => false })
    const result = await restore(descriptor)
    expect(result.state).toBe('resolved')
    expect(read).toHaveBeenCalledWith(repositories.payroll, { origin: 'real', includeDemo: false }, 'wage-a')
    if (result.state === 'resolved')
      expect(new URL(result.fullPath, 'https://test.invalid').searchParams.get('deleted')).toBe('deleted')
  })
  it('演示调用同一授权只读adapter，无权限不触发数据读取', async () => {
    const fixture = payrollDetailFixture()
    fixture.context.origin = 'demo'
    fixture.context.capabilities = [...fixture.context.capabilities, 'demo:read']
    read.mockResolvedValue(fixture)
    const restore = createTabRestoreValidator({ repositories, capabilities: () => ['payroll:read', 'demo:read'], includeDemo: () => true })
    expect((await restore({ ...descriptor, origin: 'demo', fullPath: path.replace('origin=real', 'origin=demo') })).state).toBe('resolved')
    expect(read.mock.calls[0]?.[1].origin).toBe('demo')
    read.mockClear()
    const forbidden = createTabRestoreValidator({ repositories, capabilities: () => [], includeDemo: () => false })
    expect((await forbidden(descriptor)).state).toBe('forbidden')
    expect(read).not.toHaveBeenCalled()
  })
  it('旧项目筛选仅供返回；实际工资ID或来源不一致时拒绝恢复', async () => {
    const restore = createTabRestoreValidator({ repositories, capabilities: () => ['payroll:read'], includeDemo: () => false })
    const wrong = payrollDetailFixture()
    wrong.statement.projectId = 'project-b'
    read.mockResolvedValue(wrong)
    expect((await restore(descriptor)).state).toBe('resolved')
    wrong.statement.id = 'wage-b'
    expect((await restore(descriptor)).state).toBe('mismatch')
    wrong.statement.id = 'wage-a'
    wrong.context.origin = 'demo'
    expect((await restore(descriptor)).state).toBe('mismatch')
  })
})
