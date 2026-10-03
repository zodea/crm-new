import { describe, expect, it } from 'vitest'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollAEntryReturn, payrollAWorkspaceReturn, payrollSourceContext } from '~/lib/payroll/a-navigation'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'

describe('a工资原来源返回', () => {
  const back = '/subcontract/payroll/config?origin=real&project=project-a&month=2026-09&leader=manager&managementBookId=book-a&focus=fee-a'

  it.each(([back.replace('book-a', 'bad%2Fbook'), `${back}&managementBookId=other`, back.replace('2026-09', 'bad'), `${back}&commandId=cmd`]).map(input => ({ input })))('费用配置来源保项目/月份/主体/管理簿及原分项焦点，只接受同项目稳定范围：输入案例 %#', ({ input: caseInput }) => {
    const query = { payrollReturnTo: back, payrollSourceKind: 'quantity-unit', payrollSourceId: 'unit-a', payrollProject: 'project-a' }
    expect(payrollAWorkspaceReturn(back, 'real')).toBe(back)
    expect(payrollSourceContext(query, { kind: 'quantity-unit', id: 'unit-a', projectId: 'project-a', origin: 'real' })?.configScope).toEqual({ projectId: 'project-a', month: '2026-09', leaderWorkerId: 'manager', crewId: null, book: { bookPurpose: 'management', managementBookId: 'book-a' } })
    expect(payrollSourceContext({ ...query, payrollProject: 'other' }, { kind: 'quantity-unit', id: 'unit-a', origin: 'real' })).toBeNull()
    expect(payrollAWorkspaceReturn(caseInput, 'real')).toBeNull()
    const path = `/subcontract/quantity/project-a/unit-a?${new URLSearchParams({ origin: 'real', ...query })}`
    expect(new URL(inspectRestorableTabPath(path)!.fullPath, 'https://test.invalid').searchParams.get('payrollReturnTo')).toBe(back)
    expect(inspectRestorableTabPath(back)).toBeNull()
    const worker = '/base/worker/w?origin=real'
    const wage = `/subcontract/payroll/wage?origin=real&returnTo=${encodeURIComponent(worker)}`
    expect(payrollAWorkspaceReturn(`/subcontract/payroll/form/wage?origin=real&returnTo=${encodeURIComponent(wage)}`, 'real')).toContain(encodeURIComponent(wage))
  })
  const draft = '/subcontract/payroll/new?origin=real&draftKey=draft-a&project=project-a'

  it.each((['/subcontract/payroll/new?origin=real', `${draft}&draftKey=draft-b`, 'https://evil.test/', '//evil.test/path', '/subcontract/payroll/config?origin=real', '/base/worker/form/worker-a']).map(input => ({ input })))('保存新建draftKey与独立编辑身份，不允许任意路径/另一来源/重复参数：输入案例 %#', ({ input: caseInput }) => {
    expect(payrollAWorkspaceReturn(draft, 'real')).toBe(draft)
    expect(payrollAWorkspaceReturn('/subcontract/payroll/form/wage-a?origin=real', 'real')).toBe('/subcontract/payroll/form/wage-a?origin=real')
    expect(payrollAWorkspaceReturn(caseInput, 'real')).toBeNull()
    expect(payrollAWorkspaceReturn(draft, 'demo')).toBeNull()
  })
  describe('工程量入口保留全部原筛选，限定同项目同来源', () => {
    const path = '/subcontract/quantity?origin=real&project=p&building=b&month=2026-09&view=crew&trade=泥水&assignee=worker%3Aw'
    it('关联事实保持原契约', () => {
      expect(new URL(payrollAEntryReturn(path, 'real', 'p')!, 'https://test.invalid').searchParams.get('trade')).toBe('泥水')
    })

    it.each([
      { case: 'path / \'real\' / \'other\'', input: path, argument2: 'real', argument3: 'other' },
      { case: '`{path}&commandId=cmd` / \'real\'', input: `${path}&commandId=cmd`, argument2: 'real', argument3: undefined },
      { case: 'path / \'demo\'', input: path, argument2: 'demo', argument3: undefined },
    ])('payrollAEntryReturn：$case', ({ input, argument2, argument3 }) => {
      expect(payrollAEntryReturn(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBeNull()
    })
  })
  function createInspectRestorableTabPathFixture() {
    const back = '/subcontract/payroll/new?origin=real&draftKey=draft-a&project=project-a'
    const query = new URLSearchParams({ origin: 'real', payrollReturnTo: back, payrollSourceKind: 'quantity-unit', payrollSourceId: 'unit-a', payrollProject: 'project-a', stageId: 'stage-a', itemId: 'item-a', completionId: 'completion-a' })
    const path = `/subcontract/quantity/project-a/unit-a?${query}`
    const restored = inspectRestorableTabPath(path)
    expect(new URL(restored!.fullPath, 'https://test.invalid').searchParams.get('payrollReturnTo')).toBe(back)
    expect(restored!.fullPath).toContain('completionId=completion-a')
    return { back, query, path, restored }
  }

  it('冷恢复仅保留只读来源marker，工资配置和新建写态不恢复', () => {
    createInspectRestorableTabPathFixture()
  })

  it.each([
    { case: 'path.replace(\'payrollSourceId=unit-a\', \'payrollSourceId=unit-b\')', prepare: ({ path }: Awaited<ReturnType<typeof createInspectRestorableTabPathFixture>>) => {
      return { input: path.replace('payrollSourceId=unit-a', 'payrollSourceId=unit-b') } as const
    } },
    { case: '\'/subcontract/payroll/config?origin=real\'', prepare: (_fixture: Awaited<ReturnType<typeof createInspectRestorableTabPathFixture>>) => {
      return { input: '/subcontract/payroll/config?origin=real' } as const
    } },
    { case: 'back', prepare: ({ back }: Awaited<ReturnType<typeof createInspectRestorableTabPathFixture>>) => {
      return { input: back } as const
    } },
  ])('冷恢复仅保留只读来源marker，工资配置和新建写态不恢复 / inspectRestorableTabPath：$case', ({ prepare }) => {
    const fixture = createInspectRestorableTabPathFixture()
    const { input } = prepare(fixture)
    expect(inspectRestorableTabPath(input)).toBeNull()
  })
  function createPayrollSourceContextFixture() {
    const result = resolveNavigationTarget({ kind: 'entity-detail', subject: { state: 'resolved', entity: 'quantity-unit', id: 'unit-a', label: '101', no: null }, variant: 'detail', view: null, filters: { projectId: 'project-a', dataOrigin: 'real', stageId: 'stage-a' } }, { returnTo: '/subcontract/payroll/form/wage-a?origin=real' })
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved')
      throw new Error('应有可达来源')
    const url = new URL(result.to, 'https://test.invalid')
    expect(url.pathname).toBe('/subcontract/quantity/project-a/unit-a')
    expect(url.searchParams.get('origin')).toBe('real')
    expect(url.searchParams.get('stageId')).toBe('stage-a')
    const query = Object.fromEntries(url.searchParams)
    const expected = { kind: 'quantity-unit' as const, id: 'unit-a', projectId: 'project-a', origin: 'real' as const }
    expect(payrollSourceContext(query, expected)?.statementId).toBe('wage-a')
    return { result, url, query, expected }
  }

  it('registry以稳定户身份生成来源marker，篡改/换项目时不能当原工资返回', () => {
    createPayrollSourceContextFixture()
  })

  it.each([
    { case: 'query / { ...expected, id: \'unit-b\' }', prepare: ({ query, expected }: Awaited<ReturnType<typeof createPayrollSourceContextFixture>>) => {
      return { input: query, argument2: { ...expected, id: 'unit-b' } } as const
    } },
    { case: 'query / { ...expected, projectId: \'project-b\' }', prepare: ({ query, expected }: Awaited<ReturnType<typeof createPayrollSourceContextFixture>>) => {
      return { input: query, argument2: { ...expected, projectId: 'project-b' } } as const
    } },
    { case: '{ ...query, payrollReturnTo: \'/project/project-a\' } / expected', prepare: ({ query, expected }: Awaited<ReturnType<typeof createPayrollSourceContextFixture>>) => {
      return { input: { ...query, payrollReturnTo: '/project/project-a' }, argument2: expected } as const
    } },
  ])('registry以稳定户身份生成来源marker，篡改/换项目时不能当原工资返回 / payrollSourceContext：$case', ({ prepare }) => {
    const fixture = createPayrollSourceContextFixture()
    const { input, argument2 } = prepare(fixture)
    expect(payrollSourceContext(input, argument2)).toBeNull()
  })
})
