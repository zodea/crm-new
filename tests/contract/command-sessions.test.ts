import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConstructionContractRepositoryProblem } from '~/lib/construction-contract/read-contract'
import { contractSupplierSelectionPatch, f2FormDefaults } from '~/lib/contract/page'
import { MaterialContractRepositoryProblem } from '~/lib/material-contract/read-contract'
import { SubcontractContractRepositoryProblem } from '~/lib/subcontract-contract/read-contract'
import { useConstructionContractCommandStore } from '~/stores/construction-contract-command'
import { useMaterialContractCommandStore } from '~/stores/material-contract-command'
import { useSubcontractContractCommandStore } from '~/stores/subcontract-contract-command'

const cases = [
  ['construction', useConstructionContractCommandStore],
  ['material', useMaterialContractCommandStore],
  ['subcontract', useSubcontractContractCommandStore],
] as const
const updatedAt = '2026-10-04T07:30:00.000Z'
function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}
beforeEach(() => {
  setActivePinia(createPinia())
  const storage = memoryStorage()
  vi.stubGlobal('window', { sessionStorage: storage })
  vi.stubGlobal('sessionStorage', storage)
})
afterEach(() => vi.unstubAllGlobals())

describe('合同选择分供方', () => {
  const suppliers = [
    { id: 'a', label: '分供方 A', contactName: '张先生', contactPhone: '13800000001' },
    { id: 'b', label: '分供方 B', contactName: '', contactPhone: '' },
  ]
  it.each([
    { input: { supplierId: null }, patch: { supplierId: 'a' }, expected: { supplierId: 'a', contactName: '张先生', contactPhone: '13800000001' } },
    { input: { supplierId: 'a', contactName: '手填', contactPhone: '自定' }, patch: { supplierId: 'b' }, expected: { supplierId: 'b', contactName: '', contactPhone: '' } },
  ])('首次或改选带出主档联系资料，缺值清空旧资料 / $input', ({ input, patch, expected }) => {
    expect(contractSupplierSelectionPatch(input, patch, suppliers)).toEqual(expected)
  })
  it.each([
    { input: { supplierId: 'a', contactName: '手填' }, patch: { supplierId: 'a' } },
    { input: { supplierId: 'a' }, patch: { contactName: '合同联系人' } },
    { input: { isSupplement: true, supplierId: 'a' }, patch: { supplierId: 'b' } },
  ])('相同分供方、其他编辑和补充协议不覆盖资料 / $input', ({ input, patch }) => {
    expect(contractSupplierSelectionPatch(input, patch, suppliers)).toEqual(patch)
  })
})

describe.each(cases)('%s 合同表单会话', (kind, useStore) => {
  function fixture() {
    const records = new Map<string, { version: string, draft: ReturnType<typeof f2FormDefaults> & { id: string } }>()
    const journal = new Map<string, { id: string, commandId: string, version: string, updatedAt: string, attachmentIds: string[] }>()
    const context = { workspaceId: 'w', actorId: 'u', capabilities: [`${kind}-contract:write`], projects: [], customers: [], suppliers: [] }
    const repository = {
      context: vi.fn(async () => context),
      loadForm: vi.fn(async (id: string) => {
        const row = records.get(id)
        if (!row)
          throw new Error('not found')
        return { ...row, attachments: [], updatedAt }
      }),
      execute: vi.fn(async (request: { id?: string, commandId: string, draft: ReturnType<typeof f2FormDefaults> }) => {
        const id = request.id ?? 'saved'
        const version = String(Number(records.get(id)?.version ?? '0') + 1)
        records.set(id, { version, draft: { ...request.draft, id } })
        const result = { id, commandId: request.commandId, version, updatedAt, attachmentIds: [] }
        journal.set(request.commandId, result)
        return result
      }),
      resolve: vi.fn(async (commandId: string) => journal.has(commandId)
        ? { outcome: 'applied' as const, result: journal.get(commandId)! }
        : { outcome: 'not-applied' as const, commandId }),
    }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: {
      constructionContractCommands: repository,
      materialContractCommands: repository,
      subcontractContractCommands: repository,
    } }))
    const store = useStore()
    return { records, journal, context, repository, store, session: store.createSession() }
  }

  it('响应未知后只查原命令，改变内容不能再发；确认保存后新表单重新生成身份', async () => {
    const { store, session, repository, records } = fixture()
    await store.hydrate(session, null)
    const execute = repository.execute.getMockImplementation()!
    repository.execute.mockImplementationOnce(async (request) => {
      await execute(request)
      throw new Error('network')
    })
    const input = f2FormDefaults(kind)
    await expect(store.saveForm(session, input, 'save')).rejects.toThrow()
    const original = repository.execute.mock.calls[0]![0].commandId
    await expect(store.saveForm(session, { ...input, name: '不同内容' }, 'save')).rejects.toThrow(/原提交/)
    const recovered = await store.recover(session)
    expect(recovered.outcome).toBe('applied')
    expect(repository.resolve).toHaveBeenCalledWith(original)
    expect(repository.execute).toHaveBeenCalledTimes(1)
    expect(records.size).toBe(1)
    await store.hydrate(session, null)
    await store.saveForm(session, input, 'save')
    const next = repository.execute.mock.calls[1]![0]
    expect(next.id).toBeUndefined()
    expect(next).toMatchObject({ baseVersion: null })
    expect(next.commandId).not.toBe(original)
  })

  it('两个编辑页各自携带原目标和版本，可靠读回后才结束本次提交', async () => {
    const { store, session: a, repository, records } = fixture()
    records.set('a', { version: '7', draft: { ...f2FormDefaults(kind), id: 'a' } })
    records.set('b', { version: '12', draft: { ...f2FormDefaults(kind), id: 'b' } })
    const b = store.createSession()
    await store.hydrate(a, 'a')
    await store.hydrate(b, 'b')
    await store.saveForm(a, { ...f2FormDefaults(kind), id: 'a', name: 'A 新内容' }, 'save')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', baseVersion: '7', draft: expect.objectContaining({ id: 'a', name: 'A 新内容' }) }))
    await store.saveForm(b, { ...f2FormDefaults(kind), id: 'b', name: 'B 新内容' }, 'save')
    expect(repository.execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b', baseVersion: '12' }))
    expect(a.baseVersion).toBe('8')
    expect(b.baseVersion).toBe('13')
  })

  it('重新激活只重验原身份及目标存在，不自动采用后来版本；失权继续保原基准', async () => {
    const { store, session, records, context, repository } = fixture()
    records.set('a', { version: '7', draft: { ...f2FormDefaults(kind), id: 'a', name: '原正文' } })
    await store.hydrate(session, 'a')
    store.invalidate(session)
    records.set('a', { version: '12', draft: { ...f2FormDefaults(kind), id: 'a', name: '别人后来保存' } })
    const read = await store.revalidate(session)
    expect(read.form).toMatchObject({ version: '12', draft: { id: 'a', name: '别人后来保存' } })
    expect(session).toMatchObject({ targetId: 'a', baseVersion: '7', context, authority: { workspaceId: 'w', actorId: 'u' } })
    expect(repository.execute).not.toHaveBeenCalled()
    context.actorId = 'another-actor'
    store.invalidate(session)
    await expect(store.revalidate(session)).rejects.toThrow('身份或权限')
    expect(session).toMatchObject({ targetId: 'a', baseVersion: '7', context: null, authority: { workspaceId: 'w', actorId: 'u' } })
  })

  it('保存成功但读回失败保留回执；恢复只读同一记录，不再执行写入或查命令', async () => {
    const { store, session, repository } = fixture()
    await store.hydrate(session, null)
    repository.loadForm.mockRejectedValueOnce(new Error('read failed'))
    await expect(store.saveForm(session, f2FormDefaults(kind), 'save')).rejects.toThrow(/已保存待刷新/)
    expect(session.pending?.result).toMatchObject({ id: 'saved', version: '1' })
    await expect(store.saveForm(session, f2FormDefaults(kind), 'save')).rejects.toThrow(/已保存待刷新/)
    await store.recover(session)
    expect(repository.execute).toHaveBeenCalledTimes(1)
    expect(repository.resolve).not.toHaveBeenCalled()
    expect(repository.loadForm.mock.calls.map(([id]) => id)).toEqual(['saved', 'saved'])
    expect(session).toMatchObject({ targetId: 'saved', baseVersion: '1', pending: null })
  })

  it('冷恢复只保留范围和原编号，不存正文；重开表单先核对原意图', async () => {
    const { store, session, repository } = fixture()
    await store.hydrate(session, null)
    const execute = repository.execute.getMockImplementation()!
    repository.execute.mockImplementationOnce(async (request) => {
      await execute(request)
      throw new Error('lost')
    })
    await expect(store.saveForm(session, { ...f2FormDefaults(kind), note: '不应持久化的正文' }, 'save')).rejects.toThrow()
    const storage = window.sessionStorage as unknown as ReturnType<typeof memoryStorage>
    const saved = [...storage.values.values()][0]!
    expect(JSON.parse(saved)).toEqual({ commandId: repository.execute.mock.calls[0]![0].commandId, workspaceId: 'w', actorId: 'u', family: `${kind}-contract`, targetId: null, action: 'save' })
    expect(saved).not.toContain('不应持久化')
    const next = store.createSession()
    const read = await store.hydrate(next, null)
    expect(read.recovered).toBe(true)
    expect(next.targetId).toBe('saved')
    expect(repository.execute).toHaveBeenCalledTimes(1)
    expect(storage.values.size).toBe(0)
  })

  it('存储不能可靠读回原编号时禁止发送；真实未应用封存后才允许新命令', async () => {
    const { store, session, repository } = fixture()
    await store.hydrate(session, null)
    const storage = window.sessionStorage
    const set = storage.setItem
    storage.setItem = () => {}
    await expect(store.saveForm(session, f2FormDefaults(kind), 'save')).rejects.toThrow(/存储/)
    expect(repository.execute).not.toHaveBeenCalled()
    storage.setItem = set
    repository.execute.mockRejectedValueOnce(new Error('unknown'))
    await expect(store.saveForm(session, f2FormDefaults(kind), 'save')).rejects.toThrow()
    const previous = repository.execute.mock.calls[0]![0].commandId
    expect((await store.recover(session)).outcome).toBe('not-applied')
    await store.saveForm(session, f2FormDefaults(kind), 'save')
    expect(repository.execute.mock.calls[1]![0].commandId).not.toBe(previous)
  })

  it('重复点击不重发，在途正文固定，后续输入保留；较新读取不擅自推进输入基线', async () => {
    const { store, session, repository, records } = fixture()
    records.set('a', { version: '7', draft: { ...f2FormDefaults(kind), id: 'a' } })
    await store.hydrate(session, 'a')
    const execute = repository.execute.getMockImplementation()!
    let finish!: () => void
    repository.execute.mockImplementationOnce(async (request) => {
      const result = await execute(request)
      await new Promise<void>(resolve => finish = resolve)
      records.set('a', { version: '9', draft: { ...f2FormDefaults(kind), id: 'a', name: '其他合法写入' } })
      return result
    })
    const input = { ...f2FormDefaults(kind), id: 'a', name: '本次提交' }
    const writing = store.saveForm(session, input, 'save')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    input.name = '提交后编辑'
    await expect(store.saveForm(session, input, 'save')).rejects.toThrow(/正在保存/)
    finish()
    const result = await writing
    expect(repository.execute.mock.calls[0]![0].draft.name).toBe('本次提交')
    expect(result.retainedInput).toBe(true)
    expect(input.name).toBe('提交后编辑')
    expect(session.baseVersion).toBe('8')
    expect(result.form.version).toBe('9')
  })

  it('身份切换后原编号保留，恢复原身份才能查询原提交', async () => {
    const { store, session, repository, context } = fixture()
    await store.hydrate(session, null)
    repository.execute.mockRejectedValueOnce(new Error('lost'))
    await expect(store.saveForm(session, f2FormDefaults(kind), 'save')).rejects.toThrow()
    context.actorId = 'other'
    await expect(store.recover(session)).rejects.toThrow(/身份/)
    expect(session.pending).not.toBeNull()
    expect(repository.resolve).not.toHaveBeenCalled()
    context.actorId = 'u'
    await store.recover(session)
    expect(session.pending).toBeNull()
  })

  it('预检权限等待期间切换目标，迟到预检不能发送写入且原编号保留', async () => {
    const { store, session, repository, context } = fixture()
    await store.hydrate(session, null)
    let release!: (value: typeof context) => void
    repository.context.mockImplementationOnce(() => new Promise(resolve => release = resolve))
    const writing = store.saveForm(session, f2FormDefaults(kind), 'save')
    const rejected = expect(writing).rejects.toThrow(/原提交/)
    expect(session.pending).not.toBeNull()
    store.invalidate(session)
    release(context)
    await rejected
    expect(repository.execute).not.toHaveBeenCalled()
    expect(repository.resolve).not.toHaveBeenCalled()
    expect((window.sessionStorage as unknown as ReturnType<typeof memoryStorage>).values.size).toBe(1)
  })

  it('版本冲突读取期间切换记录，旧冲突不能发布或改变新目标基线', async () => {
    const { store, session, repository, records } = fixture()
    records.set('a', { version: '7', draft: { ...f2FormDefaults(kind), id: 'a', name: 'A' } })
    records.set('b', { version: '12', draft: { ...f2FormDefaults(kind), id: 'b', name: 'B' } })
    await store.hydrate(session, 'a')
    const Problem = kind === 'construction' ? ConstructionContractRepositoryProblem : kind === 'material' ? MaterialContractRepositoryProblem : SubcontractContractRepositoryProblem
    repository.execute.mockRejectedValueOnce(new Problem({ code: 'conflict', message: '版本冲突', retryable: false }))
    let release!: (value: Awaited<ReturnType<typeof repository.loadForm>>) => void
    repository.loadForm.mockImplementationOnce(() => new Promise(resolve => release = resolve))
    const writing = store.saveForm(session, { ...f2FormDefaults(kind), id: 'a' }, 'save')
    const rejected = expect(writing).rejects.toThrow(/页面目标/)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    store.invalidate(session)
    await store.hydrate(session, 'b')
    release({ ...records.get('a')!, attachments: [], updatedAt })
    await rejected
    expect(session).toMatchObject({ targetId: 'b', baseVersion: '12', pending: null })
    expect(repository.execute).toHaveBeenCalledTimes(1)
  })
})
