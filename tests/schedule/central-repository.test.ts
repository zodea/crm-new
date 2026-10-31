import type { ScheduleCommand, ScheduleRead } from '~/lib/schedule/central-contract'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createScheduleRepository } from '~/lib/schedule/central-repository'

const query = { projectId: 'project / one', origin: 'real' as const, includeDemo: false, today: '2026-09-12' }
function read(): ScheduleRead {
  return { workspaceId: 'w', actorId: 'a', origin: 'real', sourceVersion: 'q:0+wbs:0+source', capabilities: ['schedule:read', 'schedule:write'], snapshot: { id: query.projectId, name: '测试项目', code: 'P1', groups: [], dependencies: [], disabledDependencies: [], plannedStart: null, plannedFinish: null, actualProgress: 0, plannedProgress: 0, deviationDays: 0 }, history: { logs: [], removedTasks: [], migrationEvidence: [] }, contracts: [], buildings: [], buildingCoverage: [] }
}
const command: ScheduleCommand = { commandId: 'original', workspaceId: 'w', actorId: 'a', origin: 'real', projectId: query.projectId, requiredCapability: 'schedule:write', sourceVersion: 'q:0+wbs:0+source', action: { kind: 'set-baseline' } }

describe('中央 WBS HTTP Repository', () => {
  it('只保留匹配原命令的明确未应用证明', async () => {
    const rejection = (commandId: string) => ({ response: { status: 409, _data: { data: { code: 'stale-source', message: '来源变化', retryable: false, fieldErrors: {}, traceId: null, commandId, commandOutcome: 'not-applied' } } } })
    const matched = createScheduleRepository(async () => {
      throw rejection('original')
    })
    await expect(matched.execute(command)).rejects.toMatchObject({ problem: { code: 'stale-source', commandId: 'original', commandOutcome: 'not-applied' } })
    const mismatched = createScheduleRepository(async () => {
      throw rejection('different')
    })
    await expect(mismatched.execute(command)).rejects.not.toHaveProperty('problem.commandOutcome')
  })
  it('真实HTTP往返保留来源、运行日、合同和原提交编号；对调用方只交独立数据', async () => {
    const observed: { path: string, params: Record<string, string>, method?: string, body: string }[] = []
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, 'http://localhost')
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      observed.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), method: request.method, body })
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(request.method === 'POST' ? { commandId: 'original', projectId: query.projectId, sourceVersion: 'q:0+wbs:1+source', value: ['log-1'] } : read()))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const port = (server.address() as { port: number }).port
      const repository = createScheduleRepository(async (url, options) => {
        const target = new URL(url, `http://127.0.0.1:${port}`)
        for (const [key, value] of Object.entries(options?.query ?? {})) target.searchParams.set(key, String(value))
        return (await fetch(target, { method: options?.method ?? 'GET', headers: { 'Content-Type': 'application/json' }, body: options?.body ? JSON.stringify(options.body) : undefined })).json()
      })
      const current = await repository.read(query, 'contract / one')
      expect(current.snapshot.id).toBe(query.projectId)
      expect(observed[0]!.params).toMatchObject({ projectId: query.projectId, origin: 'real', today: query.today, contractId: 'contract / one' })
      expect((await repository.execute(command)).value).toEqual(['log-1'])
      expect(JSON.parse(observed[1]!.body)).toEqual(command)
    }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
  it('错项目、跨来源、断裂关系及回执错号均保持unavailable，不能显示错误事实', async () => {
    const wire = read()
    const fetcher = vi.fn(async () => wire)
    const repository = createScheduleRepository(fetcher)
    wire.snapshot.id = 'other'
    await expect(repository.read(query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    wire.snapshot.id = query.projectId
    wire.origin = 'demo'
    await expect(repository.read(query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    wire.origin = 'real'
    wire.snapshot.dependencies = [{ id: 'd', predId: 'missing', succId: 'missing2', dependencyType: 'FS', lagDays: 0 }]
    await expect(repository.read(query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    const wrongReceipt = createScheduleRepository(async () => ({ commandId: 'another', projectId: query.projectId, sourceVersion: 'v2', value: [] }))
    await expect(wrongReceipt.execute(command)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
})
