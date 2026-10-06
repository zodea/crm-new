import { describe, expect, it, vi } from 'vitest'
import { CREW_WRITE_CAPABILITY } from '~/lib/crew-worker/command-contract'
import { createHttpCrewWorkerCommandRepository } from '~/lib/crew-worker/command-http-repository'
import { formDefaults } from '~/lib/master-data/page'

describe('班组—工人中央 command HTTP Repository', () => {
  it('显式新建班组只向中央命令端点提交会话信封', async () => {
    const fetcher = vi.fn(async (url: string) => url === '/api/read/business-session'
      ? {
          workspaceId: 'workspace-default',
          actorId: 'actor-default',
          capabilities: [CREW_WRITE_CAPABILITY],
        }
      : {
          id: 'crew-server-1',
          commandId: 'command-1',
          version: '1',
          updatedAt: '2026-08-23T00:00:00.000Z',
          attachmentIds: [],
        })
    const repository = createHttpCrewWorkerCommandRepository({ fetcher })
    const context = await repository.context()
    const draft = {
      ...formDefaults('crew'),
      name: '中央泥水班组',
      trade: '泥工',
      contactName: '陈师傅',
      contactPhone: '13812345678',
    }

    const result = await repository.executeCrew({
      workspaceId: context.workspaceId,
      actorId: context.actorId,
      requiredCapability: CREW_WRITE_CAPABILITY,
      commandId: 'command-1',
      baseVersion: null,
      action: 'save',
      draft,
      attachments: {},
    })

    expect(result.id).toBe('crew-server-1')
    expect(fetcher).toHaveBeenLastCalledWith('/api/commands/crews', {
      method: 'POST',
      body: expect.objectContaining({ commandId: 'command-1', draft }),
    })
  })

  it.each(['crew', 'worker'] as const)('严格核验%s原编号的可靠封存与原回执', async (kind) => {
    const receipt = { id: `${kind}-original`, commandId: 'command-original', version: '2', updatedAt: '2026-10-04T00:00:00.000Z', attachmentIds: [] }
    const fetcher = vi.fn().mockResolvedValue({ outcome: 'applied', result: receipt })
    const repository = createHttpCrewWorkerCommandRepository({ fetcher })
    const resolve = kind === 'crew' ? repository.resolveCrew : repository.resolveWorker
    await expect(resolve('command-original')).resolves.toEqual({ outcome: 'applied', result: receipt })
    expect(fetcher).toHaveBeenLastCalledWith(`/api/commands/${kind}s/resolve`, { method: 'POST', body: { commandId: 'command-original' } })
    fetcher.mockResolvedValue({ outcome: 'not-applied', commandId: 'command-original' })
    await expect(resolve('command-original')).resolves.toEqual({ outcome: 'not-applied', commandId: 'command-original' })
    for (const value of [
      { outcome: 'not-applied', commandId: 'another-command' },
      { outcome: 'not-applied', commandId: 'command-original', result: null },
      { outcome: 'applied', result: { ...receipt, commandId: 'another-command' } },
      { outcome: 'applied', result: { ...receipt, version: 'unknown' } },
    ]) {
      fetcher.mockResolvedValue(value)
      await expect(resolve('command-original')).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    }
  })
})
