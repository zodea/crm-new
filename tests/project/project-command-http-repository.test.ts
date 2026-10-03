import type { ProjectRepositoryProblem } from '~/lib/project/repository'
import { describe, expect, it, vi } from 'vitest'
import { PROJECT_WRITE_CAPABILITY } from '~/lib/project/command-contract'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'

function request(id?: string) {
  return {
    ...(id ? { id } : {}),
    workspaceId: 'workspace-default',
    actorId: 'actor-default',
    requiredCapability: PROJECT_WRITE_CAPABILITY,
    commandId: id ? 'command-update' : 'command-create',
    baseVersion: id ? '1' : null,
    action: 'draft' as const,
    draft: { ...(id ? { id } : {}), name: '中央项目' },
    attachments: { add: [], removeIds: [], restoreIds: [] },
  }
}

const result = {
  id: 'opaque-1',
  commandId: 'command-create',
  version: '1',
  updatedAt: '2026-08-15T08:00:00.000Z',
  attachmentIds: [],
}

describe('project command HTTP repository', () => {
  it('读取服务端会话后用 POST 新建、PUT 更新', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({
        workspaceId: 'workspace-default',
        actorId: 'actor-default',
        capabilities: ['project:write'],
      })
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce({ ...result, commandId: 'command-update', version: '2' })
    const repository = createHttpProjectCommandRepository({ fetcher })

    await repository.context()
    await repository.execute(request())
    await repository.execute(request('opaque-1'))

    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/commands/projects', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ commandId: 'command-create', baseVersion: null }),
    }))
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/commands/projects/opaque-1', expect.objectContaining({
      method: 'PUT',
      body: expect.objectContaining({ commandId: 'command-update', baseVersion: '1' }),
    }))
  })

  it('保留中央 ProblemDTO 的 409 冲突语义', async () => {
    const fetcher = vi.fn().mockRejectedValue({
      response: {
        _data: {
          data: {
            code: 'conflict',
            message: '版本冲突',
            retryable: false,
            fieldErrors: {},
            traceId: 'trace-conflict',
          },
        },
      },
    })
    const repository = createHttpProjectCommandRepository({ fetcher })

    await expect(repository.execute(request('opaque-1'))).rejects.toMatchObject<
      Partial<ProjectRepositoryProblem>
    >({ problem: { code: 'conflict', traceId: 'trace-conflict' } })
  })

  it('拒绝缺少服务端版本的伪成功结果', async () => {
    const repository = createHttpProjectCommandRepository({
      fetcher: vi.fn().mockResolvedValue({ ...result, version: undefined }),
    })

    await expect(repository.execute(request())).rejects.toMatchObject({
      problem: { code: 'internal-error' },
    })
  })

  const validForm = {
    draft: {
      id: 'opaque-1',
      name: '中央项目',
      startDate: '2026-08-15',
      contractAmount: 100,
    },
    attachments: [],
    version: '1',
    updatedAt: '2026-08-15T08:00:00.000Z',
  }

  it.each(([
    { name: '缺少正式 ID' },
    { ...validForm.draft, startDate: '15/08/2026' },
    { ...validForm.draft, contractAmount: -1 },
    { ...validForm.draft, unexpected: true },
  ]).map(input => ({ input })))('完整解码中央项目表单并拒绝无正式 ID 或脏字段', async ({ input: draft }) => {
    const repository = createHttpProjectCommandRepository({
      fetcher: vi.fn().mockResolvedValue({ ...validForm, draft }),
    })
    await expect(repository.loadForm('opaque-1')).rejects.toMatchObject({
      problem: { code: 'internal-error' },
    })
  })
})
