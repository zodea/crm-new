import type { ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { describe, expect, it } from 'vitest'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import { createProjectReadTestInstance } from '../../server/utils/project-read-test-instance'

describe('project read resettable instance', () => {
  it('按测试会话隔离场景，避免并行浏览器互相污染', async () => {
    const instance = createProjectReadTestInstance()
    instance.reset('unavailable', 'session-a')
    instance.reset('forbidden', 'session-b')

    await expect(instance.list(undefined, 'session-a')).rejects.toMatchObject<
      Partial<ProjectRepositoryProblem>
    >({
      problem: { code: 'unavailable' },
    })
    await expect(instance.list(undefined, 'session-b')).rejects.toMatchObject<
      Partial<ProjectRepositoryProblem>
    >({
      problem: { code: 'forbidden' },
    })
    await expect(instance.list({ includeDemo: 'true' }, 'session-c')).resolves.toMatchObject({
      pagination: { total: 12 },
    })

    instance.reset('ready', 'session-a')
    await expect(instance.list({ includeDemo: 'true' }, 'session-a')).resolves.toMatchObject({
      pagination: { total: 12 },
    })
  })

  it('uses the same server capability for the global demo workspace', async () => {
    const demoWorkspace = createDemoWorkspaceTestInstance()
    const instance = createProjectReadTestInstance(sessionId => demoWorkspace.capabilities(sessionId))
    demoWorkspace.reset('forbidden', 'session-denied')

    await expect(instance.list({ includeDemo: 'true' }, 'session-ready')).resolves.toBeDefined()
    await expect(instance.list({ includeDemo: 'true' }, 'session-denied')).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    })
  })
})
