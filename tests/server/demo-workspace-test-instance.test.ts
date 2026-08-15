import { describe, expect, it } from 'vitest'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'

describe('global demo workspace capability boundary', () => {
  it('只按会话 capability override 授权，不消费项目读场景', () => {
    const instance = createDemoWorkspaceTestInstance()

    expect(instance.workspace('ready')).toEqual({ allowed: true })
    instance.reset('forbidden', 'denied')
    expect(instance.workspace('denied')).toEqual({ allowed: false })
    expect(instance.workspace('project-forbidden')).toEqual({ allowed: true })
    expect(instance.workspace('project-unavailable')).toEqual({ allowed: true })
  })
})
