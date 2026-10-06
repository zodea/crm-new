import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import { createHttpCrewWorkerCommandRepository } from '~/lib/crew-worker/command-http-repository'
import { formDefaults } from '~/lib/master-data/page'
import crewResolve from '../../server/api/commands/crews/resolve.post'
import workerResolve from '../../server/api/commands/workers/resolve.post'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { crewWorkerCommandTestInstance as owner } from '../../server/utils/crew-worker-command-test-instance'

const scope = 'a03-crew-worker-resolve-http'
afterEach(() => owner.reset(scope))

describe.each(['crew', 'worker'] as const)('%s 实际原命令核对端点', (kind) => {
  it('原回执公开且封存未应用命令，测试owner隔离与原记录不动', async () => {
    const actor = resolveBusinessSession()
    const common = { workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: `${kind}-applied-http`, baseVersion: null, action: 'draft' as const, attachments: {} }
    const result = kind === 'crew'
      ? await owner.executeCrew({ ...common, requiredCapability: 'crew:write', draft: { ...formDefaults('crew'), name: '班组原事实' } }, actor, scope)
      : await owner.executeWorker({ ...common, requiredCapability: 'worker:write', draft: { ...formDefaults('worker'), name: '工人原事实' } }, actor, scope)
    const router = createRouter().post('/api/commands/crews/resolve', crewResolve).post('/api/commands/workers/resolve', workerResolve)
    const server = createServer(toNodeListener(createApp().use(router)))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('HTTP 测试未返回实际端口')
      const repository = createHttpCrewWorkerCommandRepository({ fetcher: async (path, options) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: options?.method, headers: { 'content-type': 'application/json', 'x-ruihang-test-session': scope }, body: JSON.stringify(options?.body) })
        const value = await response.json()
        if (!response.ok)
          throw Object.assign(new Error('HTTP 核对失败'), { data: value.data ?? value })
        return value
      } })
      const resolve = kind === 'crew' ? repository.resolveCrew : repository.resolveWorker
      await expect(resolve(common.commandId)).resolves.toEqual({ outcome: 'applied', result })
      await expect(resolve(`${kind}-never-http`)).resolves.toEqual({ outcome: 'not-applied', commandId: `${kind}-never-http` })
      expect(owner.resolve(kind, common.commandId, actor, 'different-test-owner')).toEqual({ outcome: 'not-applied', commandId: common.commandId })
      const request = { ...common, commandId: `${kind}-never-http` }
      const late = kind === 'crew'
        ? owner.executeCrew({ ...request, requiredCapability: 'crew:write', draft: { name: '迟到班组' } }, actor, scope)
        : owner.executeWorker({ ...request, requiredCapability: 'worker:write', draft: { name: '迟到工人' } }, actor, scope)
      await expect(late).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(kind === 'crew' ? owner.crewRows(scope) : owner.workerRows(scope)).toHaveLength(1)
      await expect(resolve(common.commandId)).resolves.toEqual({ outcome: 'applied', result })
    }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
})
