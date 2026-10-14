import { describe, expect, it } from 'vitest'
import {
  payrollDraftLocation,
  payrollFilterQuery,
  payrollFiltersFromQuery,
  payrollListLocation,
  shouldSyncPayrollListUrl,
} from '~/lib/payroll/navigation'

describe('payroll navigation state', () => {
  it.each([
    { case: '多状态', status: ['draft', 'checked'] as ('draft' | 'checked')[], expectedQuery: { status: '["draft","checked"]' }, expectedStatus: ['draft', 'checked'] },
    { case: '明确清空', status: [] as ('draft' | 'checked')[], expectedQuery: { status: '[]' }, expectedStatus: [] },
  ])('$case 往返保留输入，不受旧默认状态覆盖', ({ status, expectedQuery, expectedStatus }) => {
    const query = payrollFilterQuery({ status })
    expect(query).toEqual(expectedQuery)
    expect(payrollFiltersFromQuery(query, { status: ['released'] }).status).toEqual(expectedStatus)
  })

  it.each([
    { label: 'URL 无状态时采用默认状态', query: {}, defaults: { status: 'released' }, expected: 'released' },
    { label: '旧单值状态 URL 优先于默认多选', query: { status: 'checked' }, defaults: { status: ['released'] }, expected: 'checked' },
  ])('$label', ({ query, defaults, expected }) => {
    expect(payrollFiltersFromQuery(query, defaults).status).toBe(expected)
  })
  it('restores only supported filters from route query', () => {
    expect(payrollFiltersFromQuery({
      project: 'project-a',
      month: '2026-07',
      crew: 'crew-a',
      status: 'checked',
    })).toEqual({
      projectId: 'project-a',
      month: '2026-07',
      crewId: 'crew-a',
      status: 'checked',
    })

    expect(payrollFiltersFromQuery(
      { month: 'not-a-month', status: 'unknown' },
      { month: '2026-08', status: 'draft' },
    )).toMatchObject({
      month: '2026-08',
      status: '',
    })
  })

  it.each([undefined, '', 'unknown'])('来源 query 的空班组与无效/空状态 %s 不恢复上次筛选', (status) => {
    const restored = payrollFiltersFromQuery({ project: 'project-a', month: '2026-07', status }, {
      projectId: 'project-b',
      month: '2026-08',
      crewId: 'crew-b',
      status: 'released',
    })
    expect(restored).toEqual({ projectId: 'project-a', month: '2026-07', crewId: '', status: '' })
  })

  it('只有不携带任何工资来源键的普通入口保留缓存范围', () => {
    const cached = { projectId: 'project-a', month: '2026-07', crewId: 'crew-a', status: 'checked' as const }
    expect(payrollFiltersFromQuery({ unrelated: 'value' }, cached)).toEqual(cached)
  })

  it('uses the same filter query for list and full-page draft routes', () => {
    const filters = {
      projectId: 'project-a',
      month: '2026-07',
      crewId: 'crew-a',
      status: 'released' as const,
    }
    const query = payrollFilterQuery(filters)

    expect(query).toEqual({
      project: 'project-a',
      month: '2026-07',
      crew: 'crew-a',
      status: 'released',
    })
    expect(payrollListLocation(filters)).toEqual({
      path: '/subcontract/payroll',
      query,
    })
    expect(payrollDraftLocation(filters)).toEqual({
      path: '/subcontract/payroll/new',
      query,
    })
  })

  it.each([
    { case: '\'/subcontract/payroll\'', input: '/subcontract/payroll', expected: true },
    { case: '\'/subcontract/payroll/new\'', input: '/subcontract/payroll/new', expected: false },
    { case: '\'/subcontract/payroll/wage_statement_001\'', input: '/subcontract/payroll/wage_statement_001', expected: false },
    { case: '\'/subcontract/attendance\'', input: '/subcontract/attendance', expected: false },
  ])('载入完成后只在用户仍停留在列表页时才规范化 URL / shouldSyncPayrollListUrl：$case', ({ input, expected }) => {
    expect(shouldSyncPayrollListUrl(input)).toBe(expected)
  })

  it.each([
    { case: '\'/subcontract/payroll\' / true', input: '/subcontract/payroll', argument2: true, expected: false },
    { case: '\'/subcontract/payroll\' / false', input: '/subcontract/payroll', argument2: false, expected: true },
  ])('导航已开始但尚未确认时，路径还是列表页也不再规范化 URL / shouldSyncPayrollListUrl：$case', ({ input, argument2, expected }) => {
    expect(shouldSyncPayrollListUrl(input, argument2)).toBe(expected)
  })
})
