import { describe, expect, it } from 'vitest'
import {
  createProjectReturnOrigin,
  resolveProjectReturnContext,
  validateProjectReturnTo,
} from '~/lib/nav/return-to'

const NOW = Date.UTC(2026, 7, 21, 12, 0, 0)
const RETURN_TO = '/project?search=%E5%90%88%E5%92%8C&phase=%E6%96%BD%E5%B7%A5%E4%B8%AD&sort=name-asc&page=3&pageSize=20&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&manager=%E9%99%88%E7%BB%8F%E7%90%86&nav=origin_313#project-row-demo%3Aproj_demo_001'

describe('project returnTo contract', () => {
  it('builds a local origin snapshot from the visible list state', () => {
    expect(createProjectReturnOrigin({
      contextId: 'origin_313',
      anchorId: 'project-row-demo:proj_demo_001',
      scrollTop: 684,
      now: NOW,
      state: {
        search: '合和',
        phase: '施工中',
        sort: 'name-asc',
        page: 3,
        pageSize: 20,
        filters: {
          statuses: ['施工中'],
          plannedEnds: [],
          managers: ['陈经理'],
          customerIds: [],
        },
      },
    })).toEqual({
      id: 'origin_313',
      returnTo: RETURN_TO,
      tabKey: '/project',
      anchorId: 'project-row-demo:proj_demo_001',
      scrollTop: 684,
      expiresAt: NOW + 30 * 60_000,
    })
  })

  it('accepts only the registered project-list route and consumes known recovery query', () => {
    expect(validateProjectReturnTo(RETURN_TO)).toBe(RETURN_TO)
    expect(validateProjectReturnTo(RETURN_TO.replace('#', '&unknown=discarded#'))).toBe(RETURN_TO)
  })

  it('keeps the complete legal multi-filter context beyond legacy 2048-character URLs', () => {
    const values = Array.from({ length: 20 }, (_, index) => `${index}`.padEnd(120, '筛'))
    const origin = createProjectReturnOrigin({
      contextId: 'origin_long_context',
      anchorId: 'project-row-real:project-1',
      scrollTop: 0,
      now: NOW,
      state: {
        search: '查'.repeat(120),
        phase: 'all',
        sort: 'updated-desc',
        page: 1,
        pageSize: 10,
        filters: {
          statuses: values,
          plannedEnds: values,
          managers: values,
          customerIds: values,
        },
      },
    })

    expect(origin.returnTo.length).toBeGreaterThan(2_048)
    expect(validateProjectReturnTo(origin.returnTo)).toBe(origin.returnTo)
  })

  it.each([
    'https://example.com/project',
    'http://example.com/project',
    '//example.com/project',
    '/\\example.com/project',
    '/project\\..\\base\\supplier',
    '/project/../base/supplier',
    '/project/%2e%2e/base/supplier',
    '/base/supplier',
    '/project/proj-1',
    '/dev/kit-ui',
  ])('rejects unsafe or non-source target %s', (candidate) => {
    expect(validateProjectReturnTo(candidate)).toBeNull()
  })

  it('falls back to the canonical list for missing, mismatched, or expired local context', () => {
    const ready = {
      id: 'origin_313',
      returnTo: RETURN_TO,
      tabKey: '/project',
      anchorId: 'project-row-demo:proj_demo_001',
      scrollTop: 684,
      expiresAt: NOW + 60_000,
    }

    expect(resolveProjectReturnContext({
      returnTo: RETURN_TO,
      contextId: 'origin_313',
      now: NOW,
      load: id => id === ready.id ? ready : null,
    })).toEqual({ to: RETURN_TO, origin: ready })

    expect(resolveProjectReturnContext({
      returnTo: RETURN_TO,
      contextId: 'missing_context',
      now: NOW,
      load: () => null,
    })).toEqual({ to: '/project', origin: null })

    expect(resolveProjectReturnContext({
      returnTo: RETURN_TO.replace('search=%E5%90%88%E5%92%8C', 'search=tampered'),
      contextId: ready.id,
      now: NOW,
      load: () => ready,
    })).toEqual({ to: '/project', origin: null })

    expect(resolveProjectReturnContext({
      returnTo: RETURN_TO,
      contextId: ready.id,
      now: ready.expiresAt,
      load: () => ready,
    })).toEqual({ to: '/project', origin: null })
  })
})
