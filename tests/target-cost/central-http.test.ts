import type { TargetCostCommand } from '~/lib/target-cost/central-contract'
import { once } from 'node:events'
import { createServer } from 'node:http'
import * as h3 from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeTargetCostWire } from '~/lib/target-cost/central-codec'
import { createTargetCostRepository } from '~/lib/target-cost/central-repository'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'

afterEach(async () => {
  await quantityTestInstance.close()
  vi.unstubAllGlobals()
})

describe('预算真实 HTTP 路由与事务边界', () => {
  it('未关联项目草稿读写、原件、原键重放、数字格式与跨版本附件均经过实际端点', async () => {
    for (const key of ['defineEventHandler', 'getQuery', 'getHeader', 'getRouterParam', 'readBody', 'createError'] as const)
      vi.stubGlobal(key, h3[key])
    const router = h3.createRouter()
    router.get('/api/read/target-costs', (await import('../../server/api/read/target-costs/index.get')).default)
    router.get('/api/read/target-costs/form', (await import('../../server/api/read/target-costs/form.get')).default)
    router.get('/api/read/target-costs/:id', (await import('../../server/api/read/target-costs/[id].get')).default)
    router.get('/api/read/target-costs/:id/files/:fileId', (await import('../../server/api/read/target-costs/[id]/files/[fileId].get')).default)
    router.post('/api/commands/target-costs', (await import('../../server/api/commands/target-costs.post')).default)
    const app = h3.createApp()
    app.use(router)
    const server = createServer(h3.toNodeListener(app))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('测试地址无效')
    const base = `http://127.0.0.1:${address.port}`
    const headers = { 'content-type': 'application/json', 'x-ruihang-test-session': 'budget-http-private' }
    const get = (path: string) => fetch(`${base}${path}`, { headers })
    const post = (body: unknown) => fetch(`${base}/api/commands/target-costs`, { method: 'POST', headers, body: JSON.stringify(body) })
    try {
      const read = await (await get('/api/read/target-costs/form?origin=real&draftKey=first')).json()
      const command = { ...read.context, requiredCapability: 'target-cost:write', commandId: 'first-http', targetCostId: null, draftKey: 'first', action: { kind: 'save-header', saveAction: 'draft', draft: { name: '预算草稿', contractRevenue: null, plannedProfit: '0.00' }, files: { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] } } }
      const response = await post(command)
      expect(response.status).toBe(200)
      const result = await response.json()
      expect(await (await post(command)).json()).toEqual(result)
      const detail = await (await get(`/api/read/target-costs/${result.id}?origin=real`)).json()
      expect(detail.view.header).toMatchObject({ projectId: null, contractRevenue: null, plannedProfit: '0.00' })
      expect(detail.files).toEqual([expect.objectContaining({ ownerId: result.id, payloadState: 'available' })])
      const file = await (await get(`/api/read/target-costs/${result.id}/files/${result.attachmentIds[0]}?origin=real`)).json()
      expect(file.content).toMatchObject({ targetCostId: result.id, state: 'available', payloadBase64: 'YWJj' })
      expect((await get(`/api/read/target-costs/not-the-owner/files/${result.attachmentIds[0]}?origin=real`)).status).toBe(404)
      expect((await post({ ...command, commandId: 'bad-numeric', action: { ...command.action, draft: { plannedProfit: 0 } } })).status).toBe(422)
      expect((await post({ ...command, commandId: 'demo-write', origin: 'demo' })).status).toBe(403)
      expect((await (await get('/api/read/target-costs?origin=real')).json()).rows).toHaveLength(1)
      const rejected: TargetCostCommand = {
        ...read.context,
        requiredCapability: 'target-cost:write',
        commandId: 'stale-original-http-key',
        targetCostId: result.id,
        action: { kind: 'save-header', saveAction: 'draft', draft: { name: '旧依据不能覆盖预算' } },
      }
      const rejection = await post(encodeTargetCostWire(rejected))
      expect(rejection.status).toBe(409)
      expect(await rejection.json()).toMatchObject({ data: { code: 'stale-source', commandId: rejected.commandId, commandOutcome: 'not-applied' } })
      const repository = createTargetCostRepository(async (_path, options) => {
        const response = await post(options?.body)
        const body = await response.json()
        if (!response.ok)
          throw Object.assign(new Error('HTTP预算提交被拒绝'), { response: { status: response.status, _data: body } })
        return body
      })
      await expect(repository.execute(rejected)).rejects.toMatchObject({ problem: { code: 'stale-source', commandId: rejected.commandId, commandOutcome: 'not-applied' } })
      expect((await (await get(`/api/read/target-costs/${result.id}?origin=real`)).json()).view.header.name).toBe('预算草稿')
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
