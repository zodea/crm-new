import type { ProcessLibraryCreateCommand, ProcessLibraryVersion } from '~/lib/schedule/process-library-contract'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createProcessLibraryRepository } from '~/lib/schedule/process-library-repository'

const at = '2026-09-12T09:00:00.000Z'
function version(): ProcessLibraryVersion {
  const task = { id: 'task-a', legacyId: null, libraryId: 'version-a', libraryVersion: 1, key: 'a', name: '首道工序', trade: '木工', color: '#64748b', durationDays: 3, stageCode: 'stage-a', itemCodes: ['item-a'], sortOrder: 10, predecessorKey: null, predecessorDisabled: false, createdAt: at, updatedAt: at, deletedAt: null }
  return {
    id: 'version-a',
    code: 'decoration',
    name: '标准工序库',
    description: '不可变版本',
    version: 1,
    sourceVersion: '1',
    sourceVersionId: null,
    sortOrder: 10,
    isDefault: false,
    taskCount: 2,
    usageCount: null,
    dataOrigin: 'real',
    createdAt: at,
    createdBy: 'actor',
    updatedAt: at,
    deletedAt: null,
    migrationBatchId: null,
    legacyId: null,
    tasks: [task, { ...structuredClone(task), id: 'task-b', key: 'b', name: '后续工序', sortOrder: 20, predecessorKey: 'a' }],
  }
}
function catalog() {
  const { tasks: _tasks, ...summary } = version()
  return { origin: 'real', workspaceId: 'workspace', actorId: 'actor', capabilities: ['process-library:read', 'process-library:write'], sourceVersion: '5', seriesVersions: { decoration: 2 }, libraries: [summary] }
}
function command(): ProcessLibraryCreateCommand {
  return {
    action: 'create-version',
    commandId: 'command',
    workspaceId: 'workspace',
    actorId: 'actor',
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 2,
    sourceVersion: '1',
    draft: { sourceLibraryId: 'version-a', code: 'decoration', name: '调整版', description: '', tasks: version().tasks.map(task => ({ key: task.key, name: task.name, durationDays: task.durationDays, trade: task.trade, color: task.color, stageCode: task.stageCode ?? '', itemCodes: task.itemCodes, predecessorKey: task.predecessorKey, predecessorDisabled: task.predecessorDisabled })) },
  }
}
const invalid = { problem: { code: 'unavailable' } }

describe('工序库公开 HTTP Repository', () => {
  it('明确当前来源、编码路径和独立返回对象，目录保留已删除最高版本且使用量未知', async () => {
    const wire = catalog()
    const fetcher = vi.fn(async () => wire)
    const repository = createProcessLibraryRepository(fetcher)
    const result = await repository.list('real')
    expect(result).toEqual(wire)
    expect(fetcher).toHaveBeenCalledWith('/api/read/process-libraries', { query: { origin: 'real' }, signal: undefined })
    result.libraries[0]!.name = '只改调用方'
    expect(wire.libraries[0]!.name).toBe('标准工序库')
    const special = { ...version(), id: '版本 / a', tasks: version().tasks.map(task => ({ ...task, libraryId: '版本 / a' })) }
    const detailFetch = vi.fn(async () => special)
    const detail = await createProcessLibraryRepository(detailFetch).detail(special.id, 'real')
    expect(detailFetch).toHaveBeenCalledWith(`/api/read/process-libraries/${encodeURIComponent(special.id)}`, { query: { origin: 'real' }, signal: undefined })
    detail.tasks[0]!.itemCodes.push('only-client')
    expect(special.tasks[0]!.itemCodes).toEqual(['item-a'])
  })

  it('演示只使用显式演示查询，响应不能混入正式来源', async () => {
    const wire = catalog()
    wire.origin = 'demo'
    wire.libraries[0]!.dataOrigin = 'demo'
    const fetcher = vi.fn(async () => wire)
    await createProcessLibraryRepository(fetcher).list('demo')
    expect(fetcher).toHaveBeenCalledWith('/api/read/process-libraries', { query: { origin: 'demo', includeDemo: true }, signal: undefined })
    await expect(createProcessLibraryRepository(fetcher).list('real')).rejects.toMatchObject(invalid)
  })

  it.each(['origin', 'id', 'source-version', 'deleted', 'task-count', 'task-library', 'task-version', 'task-deleted', 'duplicate-id', 'duplicate-key'] as const)('拒收 %s 错配详情', async (kind) => {
    const wire = version()
    if (kind === 'origin')
      wire.dataOrigin = 'demo'
    if (kind === 'id')
      wire.id = 'other'
    if (kind === 'source-version')
      wire.sourceVersion = ''
    if (kind === 'deleted')
      wire.deletedAt = at
    if (kind === 'task-count')
      wire.taskCount = 1
    if (kind === 'task-library')
      wire.tasks[0]!.libraryId = 'other'
    if (kind === 'task-version')
      wire.tasks[0]!.libraryVersion = 2
    if (kind === 'task-deleted')
      wire.tasks[0]!.deletedAt = at
    if (kind === 'duplicate-id')
      wire.tasks[1]!.id = wire.tasks[0]!.id
    if (kind === 'duplicate-key')
      wire.tasks[1]!.key = wire.tasks[0]!.key
    await expect(createProcessLibraryRepository(async () => wire).detail('version-a', 'real')).rejects.toMatchObject(invalid)
  })

  it('拒收超出领域工期上限的响应', async () => {
    const wire = version()
    wire.tasks[0]!.durationDays = 366
    await expect(createProcessLibraryRepository(async () => wire).detail('version-a', 'real')).rejects.toMatchObject(invalid)
  })

  it('迁入库的有符号排序整数保持原样，不能把可核验旧版本误判为不可用', async () => {
    const wire = version()
    wire.sortOrder = -20
    wire.tasks[0]!.sortOrder = -10
    expect(await createProcessLibraryRepository(async () => wire).detail(wire.id, 'real')).toEqual(wire)
  })

  it.each(['origin', 'duplicate-id', 'duplicate-code-version', 'actor', 'series-missing', 'series-behind', 'series-invalid'] as const)('拒收 %s 的目录', async (kind) => {
    const wire = catalog()
    if (kind === 'origin')
      wire.libraries[0]!.dataOrigin = 'demo'
    if (kind === 'duplicate-id')
      wire.libraries.push({ ...wire.libraries[0]!, code: 'other' })
    if (kind === 'duplicate-code-version')
      wire.libraries.push({ ...wire.libraries[0]!, id: 'other' })
    if (kind === 'actor')
      wire.actorId = ''
    if (kind === 'series-missing')
      Reflect.deleteProperty(wire, 'seriesVersions')
    if (kind === 'series-behind')
      wire.seriesVersions.decoration = 0
    if (kind === 'series-invalid')
      wire.seriesVersions.decoration = 1.5
    await expect(createProcessLibraryRepository(async () => wire).list('real')).rejects.toMatchObject(invalid)
  })

  it('新建命令与回执精确对应，调用方后改草稿不改变已发请求', async () => {
    const input = command()
    const expected = structuredClone(input)
    const answer = { commandId: input.commandId, id: 'version-c', version: 3, sourceVersion: '3' }
    const fetcher = vi.fn(async () => answer)
    const pending = createProcessLibraryRepository(fetcher).execute(input)
    input.draft.name = '稍后改稿'
    expect(await pending).toEqual(answer)
    expect(fetcher).toHaveBeenCalledWith('/api/commands/process-libraries', { method: 'POST', body: expected })
    for (const wrong of [{ ...answer, commandId: 'other' }, { ...answer, id: '' }, { ...answer, version: 2 }, { ...answer, sourceVersion: '' }])
      await expect(createProcessLibraryRepository(async () => wrong).execute(expected)).rejects.toMatchObject(invalid)
  })

  it('取消发生在发送前、等待后或失败后都保留 AbortError，不采纳迟到结果', async () => {
    const before = new AbortController()
    before.abort()
    const untouched = vi.fn(async () => version())
    await expect(createProcessLibraryRepository(untouched).detail('version-a', 'real', { signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(untouched).not.toHaveBeenCalled()
    for (const shouldReject of [false, true]) {
      const controller = new AbortController()
      let finish!: () => void
      const fetcher = vi.fn(() => new Promise<unknown>((resolve, reject) => {
        finish = () => shouldReject ? reject(new TypeError('network')) : resolve(version())
      }))
      const pending = createProcessLibraryRepository(fetcher).detail('version-a', 'real', { signal: controller.signal })
      controller.abort()
      finish()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    }
  })

  it('真实 HTTP 错误保留服务器错误码、字段和追踪号；断网无本地回退', async () => {
    const codes = new Map([[403, 'forbidden'], [409, 'conflict'], [503, 'unavailable']])
    let status = 409
    const server = createServer((_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ statusCode: status, data: { code: codes.get(status), message: '中央错误', retryable: status === 503, fieldErrors: { code: ['保留人工稿'] }, traceId: 'trace-wire' } }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('测试 HTTP 地址无效')
    try {
      const fetcher = vi.fn(async (path: string) => {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
        const data = await response.json()
        if (!response.ok)
          throw Object.assign(new Error(response.statusText), { response: { status: response.status, _data: data } })
        return data
      })
      const repository = createProcessLibraryRepository(fetcher)
      for (const [httpStatus, code] of codes) {
        status = httpStatus
        await expect(repository.execute(command())).rejects.toMatchObject({ problem: { code, message: '中央错误', fieldErrors: { code: ['保留人工稿'] }, traceId: 'trace-wire' } })
      }
      expect(fetcher).toHaveBeenCalledTimes(3)
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(createProcessLibraryRepository(offline).list('real')).rejects.toMatchObject(invalid)
    expect(offline).toHaveBeenCalledTimes(1)
  })
})
