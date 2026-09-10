import { describe, expect, it } from 'vitest'
import {
  payrollDraftLocation,
  payrollFilterQuery,
  payrollFiltersFromQuery,
  payrollListLocation,
  shouldSyncPayrollListUrl,
} from '~/lib/payroll/navigation'

describe('payroll navigation state', () => {
  it('多状态往返保留并清除空选，不影响旧单值URL', () => {
    const filters = { status: ['draft', 'checked'] as ('draft' | 'checked')[] }
    expect(payrollFiltersFromQuery(payrollFilterQuery(filters)).status).toEqual(filters.status)
    const cleared = payrollFilterQuery({ status: [] })
    expect(cleared).toEqual({ status: '[]' })
    expect(payrollFiltersFromQuery(cleared, { status: ['released'] }).status).toEqual([])
    expect(payrollFiltersFromQuery({}, { status: 'released' }).status).toBe('released')
    expect(payrollFiltersFromQuery({ status: 'checked' }, { status: ['released'] }).status).toBe('checked')
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

  it('载入完成后只在用户仍停留在列表页时才规范化 URL', () => {
    expect(shouldSyncPayrollListUrl('/subcontract/payroll')).toBe(true)

    // 载入期间用户可能已经点进建单页或其他页面；此时补一次 replace 会把人拉回列表。
    expect(shouldSyncPayrollListUrl('/subcontract/payroll/new')).toBe(false)
    expect(shouldSyncPayrollListUrl('/subcontract/payroll/wage_statement_001')).toBe(false)
    expect(shouldSyncPayrollListUrl('/subcontract/attendance')).toBe(false)
  })

  it('导航已开始但尚未确认时，路径还是列表页也不再规范化 URL', () => {
    // 点击后到导航确认之间 route 仍指向列表页，只看路径会误判成「用户还在原地」。
    expect(shouldSyncPayrollListUrl('/subcontract/payroll', true)).toBe(false)
    expect(shouldSyncPayrollListUrl('/subcontract/payroll', false)).toBe(true)
  })
})
