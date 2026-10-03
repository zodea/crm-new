import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '../../app/lib/nav/target-registry'
import { payrollC1SourceContext, payrollC1WorkspaceReturn } from '../../app/lib/payroll/c1-navigation'

describe('c1 格式与原逐日来源', () => {
  function createPayrollC1WorkspaceReturnFixture6() {
    const matrix = `/subcontract/attendance?${new URLSearchParams({ origin: 'real', project: 'p', month: '2026-08', crew: 'c', status: '["draft","checked"]' })}`
    const back = `/subcontract/payroll/new?${new URLSearchParams({ origin: 'real', project: 'p', month: '2026-08', crew: 'c', status: '["draft","checked"]', format: 'C1', draftKey: 'draft-one', returnTo: matrix })}`
    const accepted = payrollC1WorkspaceReturn(back, 'real')
    expect(accepted).not.toBeNull()
    const result = new URL(accepted!, 'https://payroll.invalid')
    expect(result.pathname).toBe('/subcontract/payroll/new')
    expect(result.searchParams.get('draftKey')).toBe('draft-one')
    expect(result.searchParams.get('status')).toBe('["draft","checked"]')
    expect(result.searchParams.get('returnTo')).toBe(matrix)
    return { matrix, back, accepted, result }
  }

  it('个人配置返回保留原新建草稿身份、多状态与嵌套矩阵范围', () => {
    createPayrollC1WorkspaceReturnFixture6()
  })

  it.each([
    { case: '`{back}&unknown=x` / \'real\'', prepare: ({ back }: Awaited<ReturnType<typeof createPayrollC1WorkspaceReturnFixture6>>) => {
      return { input: `${back}&unknown=x`, argument2: 'real' } as const
    } },
    { case: 'back.replace(\'draft-one\', \'\') / \'real\'', prepare: ({ back }: Awaited<ReturnType<typeof createPayrollC1WorkspaceReturnFixture6>>) => {
      return { input: back.replace('draft-one', ''), argument2: 'real' } as const
    } },
    { case: 'back.replace(\'2026-08\', \'2026-13\') / \'real\'', prepare: ({ back }: Awaited<ReturnType<typeof createPayrollC1WorkspaceReturnFixture6>>) => {
      return { input: back.replace('2026-08', '2026-13'), argument2: 'real' } as const
    } },
  ])('个人配置返回保留原新建草稿身份、多状态与嵌套矩阵范围 / payrollC1WorkspaceReturn：$case', ({ prepare }) => {
    const fixture = createPayrollC1WorkspaceReturnFixture6()
    const { input, argument2 } = prepare(fixture)
    expect(payrollC1WorkspaceReturn(input, argument2)).toBeNull()
  })
  function createPayrollC1WorkspaceReturnFixture20() {
    const back = '/subcontract/payroll/new?origin=real&format=C1&draftKey=draft-one&project=p&month=2026-08&crew=c'
    const result = resolveNavigationTarget({ kind: 'source-record', subject: { state: 'resolved', entity: 'attendance', id: 'r', label: '原考勤', no: null }, variant: 'matrix', view: null, filters: { projectId: 'p', dataOrigin: 'real', month: '2026-08', crewId: 'c', workerId: 'w', workDate: '2026-08-01', recordId: 'r' } }, { returnTo: back })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved')
      throw new Error('target unavailable')
    const url = new URL(result.to, 'https://payroll.invalid')
    expect(url.pathname).toBe('/subcontract/attendance')
    expect(url.searchParams.get('record')).toBe('r')
    expect(url.searchParams.get('worker')).toBe('w')
    const query = Object.fromEntries(url.searchParams)
    expect(payrollC1SourceContext(query, { kind: 'attendance', id: 'r', origin: 'real', projectId: 'p' })?.draftKey).toBe('draft-one')
    expect(payrollC1SourceContext(query, { kind: 'attendance', id: 'another', origin: 'real', projectId: 'p' })).toBeNull()
    return { back, result, url, query }
  }

  it('按原 record/worker/date 打开矩阵并保 C1 新草稿目标，不能串格式与来源', () => {
    createPayrollC1WorkspaceReturnFixture20()
  })

  it.each([
    { case: 'back.replace(\'format=C1\', \'format=A\') / \'real\'', prepare: ({ back }: Awaited<ReturnType<typeof createPayrollC1WorkspaceReturnFixture20>>) => {
      return { input: back.replace('format=C1', 'format=A'), argument2: 'real' } as const
    } },
    { case: 'back / \'demo\'', prepare: ({ back }: Awaited<ReturnType<typeof createPayrollC1WorkspaceReturnFixture20>>) => {
      return { input: back, argument2: 'demo' } as const
    } },
  ])('按原 record/worker/date 打开矩阵并保 C1 新草稿目标，不能串格式与来源 / payrollC1WorkspaceReturn：$case', ({ prepare }) => {
    const fixture = createPayrollC1WorkspaceReturnFixture20()
    const { input, argument2 } = prepare(fixture)
    expect(payrollC1WorkspaceReturn(input, argument2)).toBeNull()
  })
})
