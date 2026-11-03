import { describe, expect, it, vi } from 'vitest'
import { CREW_WRITE_CAPABILITY } from '~/lib/crew-worker/command-contract'
import { createHttpCrewWorkerCommandRepository } from '~/lib/crew-worker/command-http-repository'
import { formDefaults } from '~/lib/master-data/page'

describe('班组—工人中央 command HTTP Repository', () => {
  it('工人导入预览严格核对关联候选与回执目标', async () => {
    const draft = { name: '合成人员', crewName: '合成班组' }
    const preview = { fingerprint: 'a'.repeat(64), candidates: [], crews: [{ id: 'crew-1', name: '合成班组', version: '2' }], projects: [] }
    const payload = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['worker:write', 'worker:list:read', 'worker:sensitive:read', 'crew:list:read'], previews: [preview] }
    const fetcher = vi.fn().mockResolvedValue(payload)
    const repository = createHttpCrewWorkerCommandRepository({ fetcher })
    expect(await repository.previewWorkerExcel([draft])).toEqual(payload)
    fetcher.mockResolvedValue({ ...payload, previews: [{ ...preview, crews: [preview.crews[0], preview.crews[0]] }] })
    await expect(repository.previewWorkerExcel([draft])).rejects.toThrow('关联候选')
    fetcher.mockResolvedValue({ id: 'other-worker', commandId: 'worker-original', version: '1', updatedAt: '2026-08-23T00:00:00.000Z', attachmentIds: [] })
    await expect(repository.importWorkerExcel({ workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'worker:write', commandId: 'worker-original', draft, decision: { kind: 'replace', fingerprint: 'a'.repeat(64), id: 'worker-1', version: '1', crew: { id: 'crew-1', version: '2' } } })).rejects.toThrow('目标不一致')
  })
  it('导入预览拒绝缺行、越权字段及不匹配回执', async () => {
    const draft = { name: '合成班组', note: '新备注' }
    const candidate = { id: 'crew-original', version: '1', name: '合成班组', fields: { name: '合成班组', note: '原备注' } }
    const payload = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['crew:write', 'crew:list:read'], previews: [{ fingerprint: 'a'.repeat(64), candidates: [candidate] }] }
    const fetcher = vi.fn().mockResolvedValue(payload)
    const repository = createHttpCrewWorkerCommandRepository({ fetcher })
    expect(await repository.previewCrewExcel([draft])).toEqual(payload)
    fetcher.mockResolvedValue({ ...payload, previews: [] })
    await expect(repository.previewCrewExcel([draft])).rejects.toThrow('行数')
    fetcher.mockResolvedValue({ ...payload, previews: [{ ...payload.previews[0], candidates: [{ ...candidate, fields: { ...candidate.fields, contactPhone: '不应泄露' } }] }] })
    await expect(repository.previewCrewExcel([draft])).rejects.toThrow('字段')
    fetcher.mockResolvedValue({ id: 'another-crew', commandId: 'import-original', version: '1', updatedAt: '2026-08-23T00:00:00.000Z', attachmentIds: [] })
    await expect(repository.importCrewExcel({ workspaceId: 'workspace', actorId: 'actor', requiredCapability: 'crew:write', commandId: 'import-original', draft, decision: { kind: 'replace', fingerprint: 'a'.repeat(64), id: 'crew-original', version: '1' } })).rejects.toThrow('目标不一致')
  })

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
