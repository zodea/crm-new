import type { BoqBuildingCommand, BoqBuildingContext } from '~/lib/boq/central-building-contract'
import type { BoqBuildingFetcher } from '~/lib/boq/central-building-repository'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createBoqBuildingRepository } from '~/lib/boq/central-building-repository'
import { parseBoqBuildingQuery } from '~/lib/boq/central-building-request'
import { createBoqBuildingFixture } from '../helpers/boq-building-fixture'

describe('中央清单楼栋实际 HTTP', () => {
  it.each([
    (context: BoqBuildingContext) => ({ ...context, projectId: 'foreign-project' }),
    (context: BoqBuildingContext) => ({ ...context, lines: [context.lines[0], context.lines[0]] }),
    (context: BoqBuildingContext) => ({ ...context, lines: [{ ...context.lines[0], qty: '0' }] }),
  ])('运行态decoder拒绝错项目、重复行、伪数字和错配回执：%#', async (makeBad) => {
    const fixture = await createBoqBuildingFixture()
    try {
      const context = await fixture.service.read(fixture.query)
      const bad = makeBad(context)
      const badRepository = createBoqBuildingRepository(async () => bad)
      await expect(badRepository.read(fixture.query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      const command: BoqBuildingCommand = { ...fixture.query, workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'owner-document:write', commandId: 'wrong-receipt', sourceVersion: context.sourceVersion, lineId: 'q-boq', buildingId: context.buildings[0]!.id, reason: '原始更正' }
      const repository = createBoqBuildingRepository(async () => ({ ...command, lineId: 'other-line', building: 'B1', auditId: 'audit' }))
      await expect(repository.execute(command)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    }
    finally { await fixture.close() }
  })

  it('实际受控来源更正、丢回执同键恢复、过期和跨合同反例均保持审计和量价', async () => {
    const fixture = await createBoqBuildingFixture()
    let loseNextResponse = false
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url!, 'http://localhost')
        let result
        if (request.method === 'GET' && url.pathname === '/api/read/boq/building-context') {
          result = await fixture.service.read(parseBoqBuildingQuery(Object.fromEntries(url.searchParams)))
        }
        else if (request.method === 'POST' && url.pathname === '/api/commands/boq-building') {
          let body = ''
          for await (const chunk of request) body += chunk.toString()
          result = await fixture.service.execute(JSON.parse(body))
          if (loseNextResponse) {
            loseNextResponse = false
            response.destroy()
            return
          }
        }
        else {
          response.writeHead(404)
          response.end()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(result))
      }
      catch (cause) {
        const problem = (cause as { problem: { code: string } }).problem
        response.writeHead(problem.code === 'forbidden' ? 403 : 409, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: problem }))
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as { port: number }
    const fetcher: BoqBuildingFetcher = async (path, options) => {
      const url = new URL(path, `http://127.0.0.1:${address.port}`)
      for (const [key, value] of Object.entries(options?.query ?? {})) url.searchParams.set(key, String(value))
      const response = await fetch(url, { method: options?.method, headers: { 'content-type': 'application/json' }, body: options?.body ? JSON.stringify(options.body) : undefined })
      const data: unknown = await response.json()
      if (!response.ok)
        throw Object.assign(new Error('HTTP request rejected'), { data })
      return data
    }
    try {
      const repository = createBoqBuildingRepository(fetcher)
      const before = await repository.read(fixture.query)
      const command: BoqBuildingCommand = { ...fixture.query, workspaceId: before.workspaceId, actorId: before.actorId, requiredCapability: 'owner-document:write', commandId: 'http-source', sourceVersion: before.sourceVersion, lineId: 'q-boq', buildingId: before.buildings.find(row => row.code === 'B2')!.id, reason: '核实原始清单楼栋' }
      loseNextResponse = true
      await expect(repository.execute(command)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
      const saved = await repository.execute(command)
      expect(saved).toMatchObject({ commandId: command.commandId, building: 'B2' })
      expect((await repository.read(fixture.query)).audit).toHaveLength(1)
      await expect(repository.execute({ ...command, commandId: 'stale' })).rejects.toMatchObject({ problem: { code: 'stale-source', commandId: 'stale', commandOutcome: 'not-applied' } })
      await expect(repository.execute({ ...command, commandId: 'cross-contract', contractId: 'another' })).rejects.toMatchObject({ problem: { code: 'not-found', commandId: 'cross-contract', commandOutcome: 'not-applied' } })
      await expect(repository.execute({ ...command, commandId: 'invalid', reason: '' })).rejects.toMatchObject({ problem: { code: 'validation-failed', commandId: 'invalid', commandOutcome: 'not-applied' } })
      await expect(repository.execute({ ...command, reason: '同编号不同内容' })).rejects.toMatchObject({ problem: { code: 'conflict' } })
      const after = await repository.read(fixture.query)
      expect(after.lines.find(row => row.id === 'q-boq')).toMatchObject({ id: 'q-boq', qty: null, unitPrice: 0, effectiveQty: null, effectiveUnitPrice: 0, building: 'B2' })
      expect(after.audit).toHaveLength(1)
      expect(after.audit[0]!.source).toMatchObject({ boqFileId: 'q-source', confirmed: true })
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await fixture.close()
    }
  })
})
