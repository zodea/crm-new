import { describe, expect, it } from 'vitest'
import {
  payrollDraftLocation,
  payrollFilterQuery,
  payrollFiltersFromQuery,
  payrollListLocation,
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
})
