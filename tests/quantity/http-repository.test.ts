import { describe, expect, it, vi } from 'vitest'
import { createQuantityRepository } from '~/lib/quantity/central-repository'

const query = { projectId: 'project', origin: 'real' as const, includeDemo: false }
const response = {
  data: { projectId: 'project', projectCode: 'P', projectName: '当前项目', matrixArchivedAt: null, buildings: [{ id: 'b', code: 'B', name: '1栋', sortOrder: 1 }], floors: [], units: [], templates: [] },
  dataOrigin: 'real',
  sourceVersion: 'quantity:project:1',
  asOf: '2026-09-11T00:00:00.000Z',
  capabilities: ['quantity:read'],
}

describe('工程量 HTTP Repository', () => {
  it('当前项目与来源经明确 HTTP 请求回读，未知金额和正文不使用本地补齐', async () => {
    const fetcher = vi.fn(async () => structuredClone(response))
    const repository = createQuantityRepository(fetcher)
    expect(await repository.region(query)).toEqual(response)
    expect(fetcher).toHaveBeenCalledWith('/api/read/quantity/region', { query })
  })

  it.each([
    { ...response, dataOrigin: 'demo' },
    { ...response, data: { ...response.data, projectId: 'other' } },
    { ...response, data: { ...response.data, floors: [{ id: 'f', buildingId: 'missing', code: '1', name: '1层', sortOrder: 1 }] } },
  ])('响应项目、来源或区域祖先错配均拒绝：%#', async (value) => {
    const repository = createQuantityRepository(async () => value)
    await expect(repository.region(query)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  })

  it('保留服务器冲突状态，断网明确不可用且每次只请求当前端点', async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error('源已变化'), { data: { code: 'stale-source', message: '源已变化', retryable: false, fieldErrors: {}, traceId: null } })
    })
    const repository = createQuantityRepository(fetcher)
    await expect(repository.region(query)).rejects.toMatchObject({ problem: { code: 'stale-source' } })
    fetcher.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(repository.region(query)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('完成命令返回缺少结果、对象错配或混入其他户的批次时拒收', async () => {
    const command = {
      workspaceId: 'workspace',
      actorId: 'actor',
      requiredCapability: 'quantity:write' as const,
      commandId: 'command',
      baseVersion: 'quantity:project:1',
      ...query,
      action: { kind: 'save-completion' as const, draft: { projectId: 'project', unitId: 'unit', stageId: 'stage', status: 'draft' as const, completedAt: null, note: '', expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: null, photos: [] } },
    }
    const result = { id: 'completion', commandId: command.commandId, sourceVersion: 'quantity:project:2', logIds: [] }
    await expect(createQuantityRepository(async () => result).execute(command)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    await expect(createQuantityRepository(async () => ({ ...result, completion: { completionId: 'other', status: 'draft', created: true, changed: true, photoIds: [], logIds: [] } })).execute(command)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const batch = { ...command, action: { kind: 'save-completion-batch' as const, draft: { projectId: 'project', trade: '油漆工', completedAt: '2026-09-11', note: '', items: [{ unitId: 'unit', stageId: 'stage', expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: null }] } } }
    await expect(createQuantityRepository(async () => ({ ...result, id: 'project', batch: { completed: [{ unitId: 'other', stageId: 'stage', unitName: '其他户', stageName: '阶段', completionId: 'c', reason: null }], drafted: [], unchanged: [], logIds: [] } })).execute(batch)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
  })

  it.each([{ completionId: 'other' }, { contentBase64: 'AQIE' }, { fileSize: 4 }])('照片校验完整归属和正文摘要，取消后的迟到响应不能提供内容：%j', async (patch) => {
    const scope = { ...query, unitId: 'unit', completionId: 'completion', photoId: 'photo' }
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([1, 2, 3])))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const value = { ...response, data: { projectId: query.projectId, unitId: scope.unitId, completionId: scope.completionId, photoId: scope.photoId, fileName: '验收.png', mimeType: 'image/png', fileSize: 3, contentBase64: 'AQID', sha256 } }
    const fetcher = vi.fn(async () => structuredClone(value))
    expect(await createQuantityRepository(fetcher).photo(scope)).toEqual(value)
    expect(fetcher).toHaveBeenCalledWith('/api/read/quantity/photo', { query: scope, signal: undefined })
    const data = { ...value.data, ...patch }
    await expect(createQuantityRepository(async () => ({ ...value, data })).photo(scope)).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    const controller = new AbortController()
    const late = createQuantityRepository(async () => {
      controller.abort()
      return value
    })
    await expect(late.photo(scope, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
