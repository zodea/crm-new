import type { PayrollARoundingRead } from '~/lib/payroll/central-a-rounding-contract'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PayrollARoundingSection from '~/components/payroll/PayrollARoundingSection.vue'

const scope = { projectId: 'project-a', leaderWorkerId: 'leader-a', book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: '2026-08' }
function read(): PayrollARoundingRead {
  return {
    context: { workspaceId: 'workspace-a', actorId: 'actor-a', origin: 'real', sourceVersion: 'rounding-source-1', capabilities: ['payroll:read', 'payroll:write'], readonly: false },
    scope,
    current: null,
    revisions: [],
    readonlyReasons: [],
  }
}
const load = vi.fn()
const save = vi.fn()

beforeEach(() => {
  load.mockResolvedValue(read())
  save.mockImplementation(async (value, rule) => ({ ...value, current: { id: 'rounding-1', projectId: scope.projectId, leaderWorkerId: scope.leaderWorkerId, book: scope.book, effectiveMonth: scope.month, revision: 1, rule, operatorId: 'actor-a', createdAt: '2026-09-21T00:00:00Z', sourceVersion: 'rounding-source-2' } }))
  vi.stubGlobal('usePayrollARoundingStore', () => ({ load, save, recover: vi.fn(), getPending: () => null }))
})
afterEach(() => vi.unstubAllGlobals())

describe('a 工资取整配置', () => {
  it('未配置时明确阻断，并保存用户选择的整百向下取整修订', async () => {
    const view = render(PayrollARoundingSection, {
      props: { scope, origin: 'real', blocked: false },
      global: {
        stubs: {
          SectionHeader: { props: ['title', 'subtitle'], template: '<header><h2>{{title}}</h2><p>{{subtitle}}</p></header>' },
          KitButton: { template: '<button><slot /></button>' },
        },
      },
    })
    await screen.findByText('当前范围尚未明确取整规则，批量资金建议会阻断。')
    await fireEvent.click(screen.getByLabelText('向下取整到整百元（不足 100 元部分暂不发）'))
    expect(screen.getByText('取整规则尚未保存；保存或撤销后才能切换配置范围。')).toBeTruthy()
    expect(view.emitted().locked?.at(-1)).toEqual([true])
    expect((screen.getByRole('button', { name: '保存取整修订' }) as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: '保存取整修订' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ scope }), { kind: 'floor', stepFen: 10_000 }))
    expect(screen.getByText('当前为第 1 版，生效月份 2026-08。')).toBeTruthy()
    expect(view.emitted().locked?.at(-1)).toEqual([false])
  })

  it('可撤销未保存取整选择并解除范围锁定', async () => {
    const view = render(PayrollARoundingSection, {
      props: { scope, origin: 'real', blocked: false },
      global: { stubs: { SectionHeader: true, KitButton: { template: '<button><slot /></button>' } } },
    })
    await screen.findByText('当前范围尚未明确取整规则，批量资金建议会阻断。')
    await fireEvent.click(screen.getByLabelText('向下取整到整百元（不足 100 元部分暂不发）'))
    await fireEvent.click(screen.getByRole('button', { name: '撤销未保存修改' }))
    expect(screen.queryByText('取整规则尚未保存；保存或撤销后才能切换配置范围。')).toBeNull()
    expect((screen.getByLabelText('不取整，按核算金额参与资金建议') as HTMLInputElement).checked).toBe(true)
    expect(view.emitted().locked?.at(-1)).toEqual([false])
  })
})
