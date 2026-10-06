import { expect, it, vi } from 'vitest'
import { createFormCommandActions } from '../../app/lib/forms/command-session'

interface Context { workspaceId: string, actorId: string, capabilities: string[], dataOrigin: 'real' }
interface Draft { id?: string, note?: string }
interface Read extends Context { draft: Draft & { id: string }, attachments: unknown[], version: string, updatedAt: string }
function fixture(validate = true) {
  const authority: Context = { workspaceId: 'read-workspace', actorId: 'read-owner', capabilities: ['read-owner:write'], dataOrigin: 'real' }
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => {
    values.delete(key)
  } }
  let changed: Partial<Context> = {}
  let record: Read = { ...authority, draft: { id: 'same-record', note: '原稿' }, attachments: [], version: '1', updatedAt: '2026-10-05T02:00:00.000Z' }
  const repository = {
    context: vi.fn(async () => structuredClone(authority)),
    loadForm: vi.fn(async () => ({ ...structuredClone(record), ...changed })),
    execute: vi.fn(async (request: { commandId: string, draft: Draft }) => {
      record = { ...record, version: '2', draft: { ...request.draft, id: record.draft.id } }
      return { id: record.draft.id, commandId: request.commandId, version: '2', updatedAt: record.updatedAt, attachmentIds: [] }
    }),
    resolve: vi.fn(async (commandId: string) => ({ outcome: 'not-applied' as const, commandId })),
  }
  const check = vi.fn((read: Read, context: Context) => {
    if (read.workspaceId !== context.workspaceId || read.actorId !== context.actorId || read.dataOrigin !== context.dataOrigin || !read.capabilities.includes('read-owner:write'))
      throw new Error('读取不属于原会话')
  })
  const actions = createFormCommandActions<Context, string, Draft, 'save', Record<string, never>, Read>({ repository: () => repository, capability: 'read-owner:write', problemFromUnknown: cause => Object.assign(cause instanceof Error ? cause : new Error('操作失败'), { problem: Reflect.get(new Object(cause), 'problem') ?? { code: 'unavailable' } }), conflict: latest => Object.assign(new Error('冲突最新版本'), { latest }), recoveryStorage: () => storage, ...(validate ? { validateReadContext: check } : {}) })
  return { actions, session: actions.createSession(), repository, values, check, changed: (value: Partial<Context>) => {
    changed = value
  }, record: () => record }
}

it.each([{ workspaceId: 'another-workspace' }, { actorId: 'another-owner' }, { capabilities: [] }])('水合拒绝同ID异工作区/身份/失权读取 %j，不采用基准', async (bad) => {
  const f = fixture()
  f.changed(bad)
  await expect(f.actions.hydrate(f.session, 'same-record')).rejects.toThrow('读取不属于原会话')
  expect(f.session).toMatchObject({ targetId: null, baseVersion: null, context: null, authority: null })
  expect(f.repository.execute).not.toHaveBeenCalled()
})
it('保存已应用后错误身份读回保原键与回执，后来输入保留；只读恢复不重复写', async () => {
  const f = fixture()
  await f.actions.hydrate(f.session, 'same-record')
  const input = { id: 'same-record', note: '发送稿' }
  f.changed({ actorId: 'another-owner' })
  const save = f.actions.saveForm(f.session, input, 'save')
  input.note = '后来输入'
  await expect(save).rejects.toThrow('已保存待刷新')
  expect(f.session.pending?.result).toMatchObject({ id: 'same-record', version: '2' })
  expect(f.values.size).toBe(1)
  expect(input.note).toBe('后来输入')
  expect(f.record().draft.note).toBe('发送稿')
  const original = f.session.pending!.id
  f.changed({})
  expect(await f.actions.recover(f.session)).toMatchObject({ outcome: 'applied', result: { commandId: original }, form: { draft: { note: '发送稿' } } })
  expect(f.repository.execute).toHaveBeenCalledTimes(1)
  expect(f.repository.resolve).not.toHaveBeenCalled()
  expect(f.values.size).toBe(0)
  expect(input.note).toBe('后来输入')
})
it('重校验和采用冲突版本均须先验证读取身份，不提升原基准', async () => {
  const f = fixture()
  await f.actions.hydrate(f.session, 'same-record')
  f.changed({ capabilities: [] })
  await expect(f.actions.revalidate(f.session)).rejects.toThrow('读取不属于原会话')
  expect(f.session.baseVersion).toBe('1')
  expect(f.session.context).toBeNull()
  f.changed({})
  await f.actions.revalidate(f.session)
  expect(() => f.actions.adoptConflictVersion(f.session, { ...f.record(), actorId: 'another-owner', version: '9' })).toThrow('读取不属于原会话')
  expect(f.session.baseVersion).toBe('1')
  f.changed({ workspaceId: 'another-workspace' })
  f.repository.execute.mockRejectedValueOnce(Object.assign(new Error('写入冲突'), { problem: { code: 'conflict' } }))
  await expect(f.actions.saveForm(f.session, { id: 'same-record', note: '保留原稿' }, 'save')).rejects.toThrow('读取不属于原会话')
  expect(f.session.baseVersion).toBe('1')
  expect(f.session.targetId).toBe('same-record')
})
it('未提供可选钩子的现有调用保持原公开行为', async () => {
  const f = fixture(false)
  f.changed({ actorId: 'another-owner' })
  expect((await f.actions.hydrate(f.session, 'same-record')).form!.draft.id).toBe('same-record')
  expect(f.check).not.toHaveBeenCalled()
})

it('默认正版本调用不因可选适配而接受零版本写回执，原key保留且不提升编辑基准', async () => {
  const f = fixture()
  await f.actions.hydrate(f.session, 'same-record')
  f.repository.execute.mockImplementationOnce(async request => ({ id: 'same-record', commandId: request.commandId, version: '0', updatedAt: '2026-10-05T02:00:00.000Z', attachmentIds: [] }))
  await expect(f.actions.saveForm(f.session, { id: 'same-record', note: '发送稿' }, 'save')).rejects.toThrow('原提交回执与当前目标不一致')
  expect(f.session.baseVersion).toBe('1')
  expect(f.session.pending?.result).toBeNull()
  expect(f.values.size).toBe(1)
  expect(f.repository.execute).toHaveBeenCalledTimes(1)
  expect(f.repository.resolve).not.toHaveBeenCalled()
})

it('默认重校验继续拒绝零版本读取，不将未知或旧零版本采用为普通新基准', async () => {
  const f = fixture()
  await f.actions.hydrate(f.session, 'same-record')
  f.repository.loadForm.mockResolvedValueOnce({ ...f.record(), version: '0' })
  await expect(f.actions.revalidate(f.session)).rejects.toThrow('重新读取与原编辑目标不一致')
  expect(f.session.baseVersion).toBe('1')
  expect(f.repository.execute).not.toHaveBeenCalled()
})
