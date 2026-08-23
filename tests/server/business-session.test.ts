import { describe, expect, it } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'

describe('default business session boundary', () => {
  it('injects stable workspace, actor and capabilities on the server', () => {
    expect(resolveBusinessSession()).toEqual({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      capabilities: [
        'project:list:read',
        'project:write',
        'customer:list:read',
        'customer:write',
        'supplier:list:read',
        'supplier:write',
        'demo:read',
        'core:migration:write',
      ],
    })
  })
})
