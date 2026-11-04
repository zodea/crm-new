import type { ProjectReturnOrigin } from '~/lib/nav/return-to'
import { describe, expect, it, vi } from 'vitest'
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

  it.each([
    { case: 'RETURN_TO', input: RETURN_TO, expected: RETURN_TO },
    { case: 'RETURN_TO.replace(\'#\', \'&unknown=discarded#\')', input: RETURN_TO.replace('#', '&unknown=discarded#'), expected: RETURN_TO },
  ])('accepts only the registered project-list route and consumes known recovery query / validateProjectReturnTo：$case', ({ input, expected }) => {
    expect(validateProjectReturnTo(input)).toBe(expected)
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

  it.each([
    { case: 'ready context', contextId: 'origin_313', returnTo: RETURN_TO, now: NOW, available: true, restored: true },
    { case: 'missing context', contextId: 'missing_context', returnTo: RETURN_TO, now: NOW, available: false, restored: false },
    { case: 'tampered search', contextId: 'origin_313', returnTo: RETURN_TO.replace('search=%E5%90%88%E5%92%8C', 'search=tampered'), now: NOW, available: true, restored: false },
    { case: 'expired context', contextId: 'origin_313', returnTo: RETURN_TO, now: NOW + 60_000, available: true, restored: false },
  ])('restores the list context or uses the canonical fallback: $case', ({ contextId, returnTo, now, available, restored }) => {
    const ready = {
      id: 'origin_313',
      returnTo: RETURN_TO,
      tabKey: '/project',
      anchorId: 'project-row-demo:proj_demo_001',
      scrollTop: 684,
      expiresAt: NOW + 60_000,
    }

    expect(resolveProjectReturnContext({
      returnTo,
      contextId,
      now,
      load: () => available ? ready : null,
    })).toEqual(restored ? { to: RETURN_TO, origin: ready } : { to: '/project', origin: null })
  })

  it.each([
    { case: '来源记录身份不一致', override: { id: 'origin_other' } },
    { case: '来源页签被改成其他列表', override: { tabKey: '/base/supplier' } },
    { case: '来源行锚点与链接不一致', override: { anchorId: 'project-row-demo:another-project' } },
    { case: '滚动位置为负数', override: { scrollTop: -1 } },
    { case: '滚动位置不是有限数', override: { scrollTop: Number.NaN } },
    { case: '过期时间不是有限数', override: { expiresAt: Number.POSITIVE_INFINITY } },
    { case: '刚到过期时刻', override: { expiresAt: NOW } },
  ])('不恢复被篡改或过期的项目列表来源：$case', ({ override }) => {
    const origin = {
      id: 'origin_313',
      returnTo: RETURN_TO,
      tabKey: '/project',
      anchorId: 'project-row-demo:proj_demo_001',
      scrollTop: 684,
      expiresAt: NOW + 1,
      ...override,
    } as ProjectReturnOrigin

    expect(resolveProjectReturnContext({ returnTo: RETURN_TO, contextId: 'origin_313', now: NOW, load: () => origin }))
      .toEqual({ to: '/project', origin: null })
  })

  it('过期前一毫秒仍可恢复原列表，过期时精确回退', () => {
    const origin: ProjectReturnOrigin = {
      id: 'origin_313',
      returnTo: RETURN_TO,
      tabKey: '/project',
      anchorId: 'project-row-demo:proj_demo_001',
      scrollTop: 684,
      expiresAt: NOW + 1,
    }
    const request = { returnTo: RETURN_TO, contextId: 'origin_313', load: () => origin }
    expect(resolveProjectReturnContext({ ...request, now: NOW })).toEqual({ to: RETURN_TO, origin })
    expect(resolveProjectReturnContext({ ...request, now: NOW + 1 })).toEqual({ to: '/project', origin: null })
  })

  it('无效上下文编号不读取来源，无法解码的锚点不能恢复', () => {
    const load = vi.fn(() => null)
    expect(resolveProjectReturnContext({ returnTo: RETURN_TO, contextId: '../wrong', now: NOW, load }))
      .toEqual({ to: '/project', origin: null })
    expect(load).not.toHaveBeenCalled()

    const invalidAnchor = '/project?nav=origin_313#project-row-%'
    const origin: ProjectReturnOrigin = { id: 'origin_313', returnTo: invalidAnchor, tabKey: '/project', anchorId: 'project-row-%', scrollTop: 0, expiresAt: NOW + 1 }
    expect(resolveProjectReturnContext({ returnTo: invalidAnchor, contextId: 'origin_313', now: NOW, load: () => origin }))
      .toEqual({ to: '/project', origin: null })
  })
})
