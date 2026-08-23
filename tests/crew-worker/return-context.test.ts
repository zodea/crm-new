import { describe, expect, it } from 'vitest'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

describe('班组—工人安全回程上下文', () => {
  it('只接受本应用班组或工人列表/详情路径', () => {
    expect(validateCrewWorkerReturnTo('/base/worker?search=%E8%99%9E&page=2#worker-real%3Aw1')).toBe('/base/worker?search=%E8%99%9E&page=2#worker-real%3Aw1')
    expect(validateCrewWorkerReturnTo('/base/crew/g1?origin=real')).toBe('/base/crew/g1?origin=real')
    expect(validateCrewWorkerReturnTo('https://evil.example/base/worker')).toBeNull()
    expect(validateCrewWorkerReturnTo('/project/p1')).toBeNull()
  })

  it('班组与工人目标只携带经过校验的 returnTo', () => {
    const worker = { state: 'resolved' as const, entity: 'worker' as const, id: 'w1', label: '张三', no: null }
    const intent = { kind: 'entity-detail' as const, subject: worker, variant: 'detail', view: null, filters: { dataOrigin: 'real' } }
    expect(resolveNavigationTarget(intent, { returnTo: '/base/crew/g1?origin=real' }))
      .toEqual({ state: 'resolved', label: '张三', to: '/base/worker/w1?origin=real&returnTo=%2Fbase%2Fcrew%2Fg1%3Forigin%3Dreal' })
    expect(resolveNavigationTarget(intent, { returnTo: 'https://evil.example' }))
      .toEqual({ state: 'resolved', label: '张三', to: '/base/worker/w1?origin=real' })
  })
})
