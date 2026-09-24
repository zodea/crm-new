// @vitest-environment jsdom
import type { TargetCostCommand, TargetCostFormRead, TargetCostListRead } from '~/lib/target-cost/central-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { targetCostProblem } from '~/lib/target-cost/central-contract'
import { useTargetCostStore } from '~/stores/target-cost'
import { useTargetCostListStore } from '~/stores/target-cost-list'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
const local = vi.hoisted(() => ({ getDb: vi.fn(), select: vi.fn(), withTransaction: vi.fn() }))
vi.mock('~/lib/db/connection', () => local)
const repo = { list: vi.fn(), form: vi.fn(), execute: vi.fn() }
function read(id: string | null = 'a', version = 'read-original', actorId = 'actor'): TargetCostFormRead {
  return { context: { workspaceId: 'workspace', actorId, origin: 'real', sourceVersion: version, capabilities: ['target-cost:read', 'target-cost:write'] }, targetCostId: id, draftKey: id ? null : 'new-draft', draft: { id: id ?? undefined, name: id ?? '草稿' }, files: [], projects: [], projectOptionsStatus: 'available', deletedAt: null }
}
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  repo.form.mockImplementation(async (_query, id, draftKey) => ({ ...read(id), draftKey: id ? null : draftKey }))
  repo.list.mockResolvedValue({ context: read().context, rows: [] })
  repo.execute.mockImplementation(async (command: TargetCostCommand) => ({ id: command.targetCostId ?? 'created', commandId: command.commandId, sourceVersion: 'saved', attachmentIds: [], affectedVersionIds: [command.targetCostId ?? 'created'], logIds: [] }))
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
    expect(store.getPendingForList(listing).map(row => [row.command.targetCostId, row.command.action.kind, row.state])).toEqual([['a', 'delete', 'unknown']])
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
    expect(repo.execute.mock.calls[0]![0]).toMatchObject({ targetCostId: 'a', sourceVersion: 'read-original' })
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
    expect(pending.command.action).toMatchObject({ files: { add: [{ payloadBase64: 'YWJj' }] } })
    expect(() => store.saveForm(original, { name: '新稿' }, 'draft')).toThrow('原提交')
    expect(store.getPending(read('b'))).toBeNull()
    expect(store.getPending(read(null, 'x', 'other-actor'))).toBeNull()
    const result = await store.recover(pending)
    expect(result.id).toBe('created')
    expect(repo.execute.mock.calls[1]![0]).toEqual(pending.command)
    expect(store.getPending(original)).toBeNull()
  })
  it('通用stale/无权不释放原键，只有本命令未应用证明可释放', async () => {
    const store = useTargetCostStore()
    const original = read()
    repo.execute.mockRejectedValueOnce(targetCostProblem('unavailable', '失响应'))
    await expect(store.saveForm(original, {}, 'draft')).rejects.toThrow()
    const pending = store.getPending(original)!
    repo.execute.mockRejectedValueOnce(targetCostProblem('stale-source', '后续来源变化'))
    await expect(store.recover(pending)).rejects.toThrow()
    expect(store.getPending(original)?.command.commandId).toBe(pending.command.commandId)
    const absent = targetCostProblem('stale-source', '明确未写入')
    Object.assign(absent.problem, { commandId: pending.command.commandId, commandOutcome: 'not-applied' })
    repo.execute.mockRejectedValueOnce(absent)
    await expect(store.recover(pending)).rejects.toThrow()
    expect(store.getPending(original)).toBeNull()
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
