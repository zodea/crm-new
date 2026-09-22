import { describe, expect, it } from 'vitest'
import { processLibraryNavigationQuery, processLibraryReturnTo } from '~/lib/schedule/process-library-navigation'

describe('工序库建组返回上下文', () => {
  it('保留同来源稳定项目的建组入口，复制来源单独传递', () => {
    const returnTo = '/schedule/new?project=project-443&origin=real'
    expect(processLibraryReturnTo({ origin: 'real', returnTo })).toBe(returnTo)
    expect(processLibraryNavigationQuery('real', returnTo, 'version-1')).toEqual({ origin: 'real', returnTo, source: 'version-1' })
  })
  it.each([
    'https://evil.example/schedule/new?project=p&origin=real',
    '//evil.example/schedule/new?project=p&origin=real',
    '/schedule/new?project=p&origin=demo',
    '/schedule/new?project=p&origin=real&project=q',
    '/schedule/new?project=p&origin=real&step=3',
    '/schedule/new?project=p&origin=real#secret',
    '/project/form?project=p&origin=real',
    '/schedule/new?project=%00&origin=real',
    '/schedule/new?origin=real',
  ])('拒绝未授权的返回地址：%s', (returnTo) => {
    expect(processLibraryReturnTo({ origin: 'real', returnTo })).toBeNull()
    expect(processLibraryNavigationQuery('real', returnTo)).toEqual({ origin: 'real' })
  })
})
