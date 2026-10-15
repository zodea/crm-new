import { describe, expect, it } from 'vitest'
import {
  payrollFiltersFromQuery,
} from '~/lib/payroll/navigation'

describe('payroll navigation state', () => {
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
})
