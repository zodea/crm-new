import { describe, expect, it } from 'vitest'
import {
  payrollDraftLocation,
  payrollFilterQuery,
  payrollFiltersFromQuery,
  payrollListLocation,
  shouldSyncPayrollListUrl,
} from '~/lib/payroll/navigation'

describe('payroll navigation state', () => {
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
      status: 'draft',
    })
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
