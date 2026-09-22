import { once } from 'node:events'
import { createServer } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import reset from '../../server/api/testing/process-libraries/reset.post'
import { processLibraryService, processLibrarySession } from '../../server/utils/process-library-runtime'

async function runHttp(work: (url: string) => Promise<void>) {
  const app = createApp()
  app.use(reset)
  const server = createServer(toNodeListener(app))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('测试地址无效')
  try {
    await work(`http://127.0.0.1:${address.port}`)
  }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}
function seed(sessionId: string) {
  const session = processLibrarySession(sessionId)
  return processLibraryService.execute({
    action: 'create-version',
    commandId: 'reset-fixture',
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 0,
    sourceVersion: null,
    draft: { sourceLibraryId: null, code: 'reset', name: '合成测试库', description: '', tasks: [{ key: 'a', name: '合成工序', durationDays: 1, trade: '', color: '#64748b', stageCode: '', itemCodes: [], predecessorKey: null }] },
  }, session, sessionId)
}

describe('工序库测试重置端点', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('生产环境始终404；非生产缺少reset或session证明均403且保留事实', async () => {
    const id = 'reset-blocked-443'
    seed(id)
    await runHttp(async (url) => {
      vi.stubEnv('NODE_ENV', 'production')
      expect((await fetch(url, { method: 'POST', headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id } })).status).toBe(404)
      vi.stubEnv('NODE_ENV', 'test')
      for (const headers of [{}, { 'x-ruihang-test-reset': '1' }, { 'x-ruihang-test-session': id }])
        expect((await fetch(url, { method: 'POST', headers })).status).toBe(403)
      expect(processLibraryService.catalog('real', processLibrarySession(id), id).libraries).toHaveLength(1)
    })
    processLibraryService.resetTestSession(processLibrarySession(id), id)
  })
  it('合法测试重置只清当前workspace/session，不动另一个合成会话', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    seed('reset-a-443')
    seed('reset-b-443')
    await runHttp(async (url) => {
      const response = await fetch(url, { method: 'POST', headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': 'reset-a-443' } })
      expect(response.status).toBe(200)
      expect(processLibraryService.catalog('real', processLibrarySession('reset-a-443'), 'reset-a-443').libraries).toHaveLength(0)
      expect(processLibraryService.catalog('real', processLibrarySession('reset-b-443'), 'reset-b-443').libraries).toHaveLength(1)
    })
    processLibraryService.resetTestSession(processLibrarySession('reset-b-443'), 'reset-b-443')
  })
})
