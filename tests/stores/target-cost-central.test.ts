// @vitest-environment jsdom
import type { TargetCostCommand, TargetCostFormRead, TargetCostListRead } from '~/lib/target-cost/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { targetCostProblem } from '~/lib/target-cost/central-contract'
import { createTargetCostRepository } from '~/lib/target-cost/central-repository'
import { useTargetCostStore } from '~/stores/target-cost'
import { useTargetCostListStore } from '~/stores/target-cost-list'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
const local = vi.hoisted(() => ({ getDb: vi.fn(), select: vi.fn(), withTransaction: vi.fn() }))
vi.mock('~/lib/db/connection', () => local)
const repo = { list: vi.fn(), form: vi.fn(), execute: vi.fn(), resolve: vi.fn() }
const versions = new Map<string, string>()
function read(id: string | null = 'a', version = 'budget:1+projects:original', actorId = 'actor'): TargetCostFormRead {
  return { context: { workspaceId: 'workspace', actorId, origin: 'real', sourceVersion: version, capabilities: ['target-cost:read', 'target-cost:write'] }, targetCostId: id, draftKey: id ? null : 'new-draft', draft: { id: id ?? undefined, name: id ?? '草稿' }, files: [], projects: [], projectOptionsStatus: 'available', deletedAt: null }
}
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  versions.clear()
  setActivePinia(createPinia())
  repo.form.mockImplementation(async (_query, id, draftKey) => ({ ...read(id, versions.get(id) ?? 'budget:1+projects:original'), draftKey: id ? null : draftKey }))
  repo.list.mockResolvedValue({ context: read().context, rows: [] })
  repo.execute.mockImplementation(async (command: TargetCostCommand) => {
    const id = command.targetCostId ?? 'created'
    versions.set(id, 'budget:2+projects:original')
    return { id, commandId: command.commandId, sourceVersion: 'budget:2+projects:original', attachmentIds: [], affectedVersionIds: [id], logIds: [] }
  })
  repo.resolve.mockImplementation(async (descriptor) => {
    const original = repo.execute.mock.calls.find(([command]) => command.commandId === descriptor.commandId)![0] as TargetCostCommand
    const id = original.targetCostId ?? 'created'
    versions.set(id, 'budget:2+projects:original')
    return { outcome: 'applied', result: { id, commandId: original.commandId, sourceVersion: 'budget:2+projects:original', attachmentIds: [], affectedVersionIds: [id], logIds: [] } }
  })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { targetCosts: repo } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('预算固定页面快照与原提交恢复', () => {
  it('列表只展示当前身份与可见版本的原提交，删除或恢复失响应仍可核对', async () => {
    const store = useTargetCostStore()
    repo.execute.mockRejectedValue(new Error('响应丢失'))
    await expect(store.remove(read('a'))).rejects.toThrow()
    await expect(store.restore(read('b'))).rejects.toThrow()
    await expect(store.saveForm(read(null), {}, 'draft')).rejects.toThrow()
    const listing: TargetCostListRead = { context: read().context, rows: [{ id: 'a' }] as TargetCostListRead['rows'] }
    expect(store.getPendingForList(listing).map(row => [row.descriptor.targetId, row.descriptor.action, row.state])).toEqual([['a', 'delete', 'unknown']])
    expect(store.getPendingForList({ ...listing, context: { ...listing.context, actorId: 'different' } })).toEqual([])
    expect(store.getPendingForList({ ...listing, context: { ...listing.context, origin: 'demo' } })).toEqual([])
    expect(store.getPendingForList({ ...listing, context: { ...listing.context, workspaceId: 'different' } })).toEqual([])
  })
  it('读取列表/另一个版本不抬确认基准，正式浏览器从不读本地库', async () => {
    const store = useTargetCostStore()
    const original = await store.loadForm('a')
    repo.form.mockResolvedValueOnce(read('b', 'newer'))
    await store.loadForm('b')
    await useTargetCostListStore().load()
    await store.saveForm(original, { ...original.draft, name: 'edited' }, 'draft')
    expect(repo.execute.mock.calls[0]![0]).toMatchObject({ targetCostId: 'a', sourceVersion: 'budget:1+projects:original' })
    expect(repo.execute.mock.calls[0]![0]).not.toHaveProperty('capabilities')
    expect(local.getDb).not.toHaveBeenCalled()
    expect(local.select).not.toHaveBeenCalled()
  })
  it('unknown保原附件bytes/key，按版本/草稿/身份隔离，原恢复不提交新页内容', async () => {
    const store = useTargetCostStore()
    const original = await store.loadForm(null, 'real', 'new-draft')
    const files = { add: [{ fileName: '预算.xlsx', fileSize: 3, mimeType: 'application/octet-stream', payloadBase64: 'YWJj' }] }
    repo.execute.mockRejectedValueOnce(new Error('响应丢失'))
    await expect(store.saveForm(original, {}, 'draft', files)).rejects.toThrow('响应丢失')
    const pending = store.getPending(original)!
    files.add[0]!.payloadBase64 = 'ZGVm'
    expect(pending.command?.action).toMatchObject({ files: { add: [{ payloadBase64: 'YWJj' }] } })
    expect(() => store.saveForm(original, { name: '新稿' }, 'draft')).toThrow('原提交')
    expect(store.getPending(read('b'))).toBeNull()
    expect(store.getPending(read(null, 'x', 'other-actor'))).toBeNull()
    const result = await store.recover(pending)
    expect(result.id).toBe('created')
    expect(repo.execute).toHaveBeenCalledTimes(1)
    expect(repo.resolve.mock.calls[0]![0]).toMatchObject({ commandId: pending.descriptor.commandId, workspaceId: 'workspace', actorId: 'actor' })
    expect(store.getPending(original)).toBeNull()
  })
  it('通用stale/无权不释放原键，只有本命令未应用证明可释放', async () => {
    const store = useTargetCostStore()
    const original = read()
    repo.execute.mockRejectedValueOnce(targetCostProblem('unavailable', '失响应'))
    await expect(store.saveForm(original, {}, 'draft')).rejects.toThrow()
    const pending = store.getPending(original)!
    repo.resolve.mockRejectedValueOnce(targetCostProblem('stale-source', '后续来源变化'))
    await expect(store.recover(pending)).rejects.toThrow()
    expect(store.getPending(original)?.descriptor.commandId).toBe(pending.descriptor.commandId)
    repo.resolve.mockResolvedValueOnce({ outcome: 'not-applied', commandId: pending.descriptor.commandId })
    await expect(store.recover(pending)).rejects.toThrow()
    expect(store.getPending(original)).toBeNull()
  })
  it.each([
    { label: '原键明确未应用', status: 409, code: 'stale-source', sameKey: true, outcome: 'not-applied', retained: false },
    { label: '其他编号的未应用证明', status: 409, code: 'stale-source', sameKey: false, outcome: 'not-applied', retained: true },
    { label: '原键仍未知', status: 409, code: 'stale-source', sameKey: true, outcome: 'unknown', retained: true },
    { label: '无证明的旧版本错误', status: 409, code: 'stale-source', sameKey: true, outcome: null, retained: true },
    { label: '撤权不能证明未应用', status: 403, code: 'forbidden', sameKey: true, outcome: 'not-applied', retained: true },
  ])('实际HTTP adapter：$label只按可信原键决定pending，不丢原输入', async ({ status, code, sameKey, outcome, retained }) => {
    const fetcher = vi.fn(async (_url: string, options?: { body?: Record<string, unknown> }) => {
      throw Object.assign(new Error('HTTP原提交拒绝'), { response: { status, _data: { data: {
        code,
        message: '原提交尚须核对',
        retryable: false,
        fieldErrors: {},
        traceId: null,
        commandId: sameKey ? options?.body?.commandId : 'other-command-key',
        ...(outcome === null ? {} : { commandOutcome: outcome }),
        privateBody: '传输额外字段不得成为公共问题',
      } } } })
    })
    const repository = createTargetCostRepository(fetcher)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { targetCosts: repository } }))
    const store = useTargetCostStore()
    const original = read()
    const draft = { name: '原未保存预算输入' }
    const failure = await store.saveForm(original, draft, 'draft').catch(cause => cause)
    const commandId = fetcher.mock.calls[0]![1]!.body!.commandId
    expect(failure.problem.code).toBe(code)
    expect(failure.problem).not.toHaveProperty('privateBody')
    expect(draft).toEqual({ name: '原未保存预算输入' })
    if (retained) {
      expect(failure.problem).not.toHaveProperty('commandOutcome')
      expect(store.getPending(original)).toMatchObject({ command: { commandId, action: { draft } }, state: 'unknown' })
    }
    else {
      expect(failure.problem).toMatchObject({ commandId, commandOutcome: 'not-applied' })
      expect(store.getPending(original)).toBeNull()
    }
  })
  it('列表双来源迟到请求不覆盖新读，demo未授权不尝试本地适配', async () => {
    let resolve!: (value: unknown) => void
    repo.list.mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    const store = useTargetCostListStore()
    const old = store.load('real')
    repo.list.mockResolvedValueOnce({ context: read().context, rows: [{ id: 'fresh' }] })
    await store.load('real')
    resolve({ context: read().context, rows: [{ id: 'late' }] })
    await old
    expect(store.rows.map(row => row.id)).toEqual(['fresh'])
    repo.list.mockRejectedValueOnce(targetCostProblem('forbidden', '演示无权'))
    await expect(store.load('demo')).rejects.toThrow('演示无权')
    expect(local.getDb).not.toHaveBeenCalled()
  })
})
