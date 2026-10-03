import { describe, expect, it } from 'vitest'
import { validateCrewWorkerReturnTo } from '~/lib/crew-worker/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

describe('班组—工人安全回程上下文', () => {
  it.each([
    { case: '\'/base/worker?search=%E8%99%9E&page=2#worker-real%3Aw1\'', input: '/base/worker?search=%E8%99%9E&page=2#worker-real%3Aw1', expected: '/base/worker?search=%E8%99%9E&page=2#worker-real%3Aw1' },
    { case: '\'/base/crew/g1?origin=real\'', input: '/base/crew/g1?origin=real', expected: '/base/crew/g1?origin=real' },
  ])('只接受本应用班组或工人列表/详情路径 / validateCrewWorkerReturnTo：$case', ({ input, expected }) => {
    expect(validateCrewWorkerReturnTo(input)).toBe(expected)
  })

  it.each([
    { case: '\'https://evil.example/base/worker\'', input: 'https://evil.example/base/worker' },
    { case: '\'/project/p1\'', input: '/project/p1' },
  ])('只接受本应用班组或工人列表/详情路径 / validateCrewWorkerReturnTo：$case', ({ input }) => {
    expect(validateCrewWorkerReturnTo(input)).toBeNull()
  })

  describe('班组与工人目标只携带经过校验的 returnTo', () => {
    const worker = { state: 'resolved' as const, entity: 'worker' as const, id: 'w1', label: '张三', no: null }
    const intent = { kind: 'entity-detail' as const, subject: worker, variant: 'detail', view: null, filters: { dataOrigin: 'real' } }
    it.each([
      { case: 'intent / { returnTo: \'/base/crew/g1?origin=real\' }', input: intent, argument2: { returnTo: '/base/crew/g1?origin=real' }, expected: { state: 'resolved', label: '张三', to: '/base/worker/w1?origin=real&returnTo=%2Fbase%2Fcrew%2Fg1%3Forigin%3Dreal' } },
      { case: 'intent / { returnTo: \'https://evil.example\' }', input: intent, argument2: { returnTo: 'https://evil.example' }, expected: { state: 'resolved', label: '张三', to: '/base/worker/w1?origin=real' } },
    ])('resolveNavigationTarget：$case', ({ input, argument2, expected }) => {
      expect(resolveNavigationTarget(structuredClone(input), structuredClone(argument2))).toEqual(expected)
    })
  })
})
