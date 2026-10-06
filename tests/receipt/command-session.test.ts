import type { ReceiptCommand, ReceiptDetail } from '../../app/lib/receipt/contract'
import { describe, expect, it, vi } from 'vitest'
import { createReceiptCommandActions } from '../../app/lib/receipt/command-session'
import { receiptProblem } from '../../app/lib/receipt/contract'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { createReceiptReadService } from '../../server/utils/receipt-read-service'
import { command, draft, references, session } from './fixtures'

function fixture() {
  const commands = createReceiptCommandTestInstance({ references: () => references })
  const read = createReceiptReadService({ commands, references: () => references })
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {
    values.set(key, value)
  }, removeItem: (key: string) => {
    values.delete(key)
  } }
  const repository = {
    context: vi.fn(async () => read.context(session)),
    detail: vi.fn(async (id: string) => read.detail(id, { origin: 'real' }, session)),
    execute: vi.fn(async (request: ReceiptCommand) => commands.execute(request, session)),
    resolve: vi.fn(async (commandId: string) => commands.resolve(commandId, session)),
  }
  const actions = createReceiptCommandActions(() => repository, () => storage)
  return { commands, repository, actions, values, storage, form: actions.createSession() }
}

describe('收款表单命令会话', () => {
  it('读取未成功时不能写；保存后可靠读回同一记录才清原编号并采用回执版本', async () => {
    const { actions, form, repository, values } = fixture()
    await expect(actions.saveForm(form, draft, 'draft')).rejects.toThrow(/读取/)
    repository.context.mockRejectedValueOnce(receiptProblem('unavailable', '读取失败'))
    await expect(actions.hydrate(form, null)).rejects.toThrow(/读取失败/)
    await expect(actions.saveForm(form, draft, 'draft')).rejects.toThrow(/读取/)
    await actions.hydrate(form, null)
    const result = await actions.saveForm(form, draft, 'submit')
    expect(form).toMatchObject({ targetId: result.id, baseVersion: result.version, pending: null, busy: false })
    expect(repository.detail).toHaveBeenCalledWith(result.id, { origin: 'real' })
    expect(result.readbackConfirmed).toBe(true)
    expect(values.size).toBe(0)
    await actions.saveForm(form, { ...draft, note: '保存后继续编辑' }, 'save')
    expect(repository.execute.mock.calls[1]![0]).toMatchObject({ id: result.id, baseVersion: result.version })
  })

  it('响应丢失只核对原编号，不重发或接受异文；封存未应用后才能提交新意图', async () => {
    const { actions, form, repository, commands } = fixture()
    await actions.hydrate(form, null)
    repository.execute.mockImplementationOnce(async (request) => {
      commands.execute(request, session)
      throw receiptProblem('unavailable', '响应丢失')
    })
    const input = { ...draft }
    await expect(actions.saveForm(form, input, 'submit')).rejects.toThrow(/响应丢失/)
    const original = repository.execute.mock.calls[0]![0].commandId
    await expect(actions.saveForm(form, { ...input, note: '不同内容' }, 'submit')).rejects.toThrow(/原提交/)
    const recovered = await actions.recover(form)
    expect(recovered.outcome).toBe('applied')
    expect(repository.resolve).toHaveBeenCalledWith(original)
    expect(repository.execute).toHaveBeenCalledTimes(1)
    expect(commands.facts().rows).toHaveLength(1)
    expect(form.baseVersion).toBe('1')
    repository.execute.mockRejectedValueOnce(receiptProblem('unavailable', '网络错误'))
    await expect(actions.saveForm(form, input, 'save')).rejects.toThrow()
    const previous = repository.execute.mock.calls.at(-1)![0].commandId
    expect((await actions.recover(form)).outcome).toBe('not-applied')
    await actions.saveForm(form, { ...input, note: '不同内容' }, 'save')
    expect(repository.execute.mock.calls.at(-1)![0].commandId).not.toBe(previous)
    expect(commands.facts().rows).toHaveLength(1)
  })

  it('写入成功而详情读取失败保留回执；重复点击不重发，恢复只读原记录', async () => {
    const { actions, form, repository, values } = fixture()
    await actions.hydrate(form, null)
    repository.detail.mockRejectedValueOnce(receiptProblem('unavailable', '详情暂时不可用'))
    await expect(actions.saveForm(form, draft, 'submit')).rejects.toThrow(/已保存待刷新/)
    expect(form.pending?.result).toMatchObject({ version: '1' })
    expect(values.size).toBe(1)
    await expect(actions.saveForm(form, draft, 'submit')).rejects.toThrow(/已保存待刷新/)
    const recovered = await actions.recover(form)
    expect(recovered.outcome).toBe('applied')
    expect(repository.execute).toHaveBeenCalledTimes(1)
    expect(repository.resolve).not.toHaveBeenCalled()
    expect(repository.detail).toHaveBeenCalledTimes(2)
    expect(values.size).toBe(0)
  })

  it('在途正文固定、阻止并发；旧表单的迟到响应不覆盖新会话或发布当前范围信号', async () => {
    const { actions, form, repository, commands, values } = fixture()
    const other = commands.execute(command({ commandId: 'other-record', draft: { ...draft, no: 'SK-02' } }), session)
    await actions.hydrate(form, null)
    let finish!: () => void
    repository.execute.mockImplementationOnce(async (request) => {
      const result = commands.execute(request, session)
      await new Promise<void>(resolve => finish = resolve)
      return result
    })
    const input = { ...draft }
    const writing = actions.saveForm(form, input, 'submit')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    input.note = '请求后的编辑'
    expect(repository.execute.mock.calls[0]![0].draft.note).toBe(draft.note)
    await expect(actions.saveForm(form, input, 'submit')).rejects.toThrow(/保存/)
    await actions.hydrate(form, other.id)
    finish()
    await expect(writing).rejects.toThrow(/原收款/)
    expect(form).toMatchObject({ targetId: other.id, baseVersion: '1', busy: false })
    expect(actions.latestWrite.value).toBeNull()
    expect(values.size).toBe(1)
    const previous = actions.createSession()
    const restored = await actions.hydrate(previous, null)
    expect(restored?.recovered).toBe(true)
    expect(previous.targetId).not.toBe(other.id)
    expect(repository.execute).toHaveBeenCalledTimes(1)
  })

  it('冷恢复保留原编号且不存正文，成功核对后只读原收款', async () => {
    const { actions, form, repository, commands, values } = fixture()
    await actions.hydrate(form, null)
    repository.execute.mockImplementationOnce(async (request) => {
      commands.execute(request, session)
      throw receiptProblem('unavailable', 'lost')
    })
    await expect(actions.saveForm(form, draft, 'submit')).rejects.toThrow()
    const stored = [...values.values()][0]!
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'targetId', 'workspaceId'])
    expect(stored).not.toContain(draft.note)
    const next = actions.createSession()
    const restored = await actions.hydrate(next, null)
    expect(restored?.detail?.record.draft.note).toBe(draft.note)
    expect(repository.execute).toHaveBeenCalledTimes(1)
    expect(values.size).toBe(0)
  })

  it('迟到读取不会将另一张收款的版本或草稿交给当前表单', async () => {
    const { actions, form, repository, commands } = fixture()
    const saved = commands.execute(command(), session)
    const actual = await repository.detail(saved.id)
    let finish!: (value: ReceiptDetail) => void
    repository.detail.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const old = actions.hydrate(form, saved.id)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await actions.hydrate(form, null)
    finish(actual)
    expect(await old).toBeNull()
    expect(form.targetId).toBeNull()
  })

  it('没有写权限或关联被隐藏的详情不能保存；原提交遇身份或权限切换保留编号', async () => {
    const { actions, form, repository, commands, values } = fixture()
    const saved = commands.execute(command(), session)
    repository.detail.mockResolvedValueOnce({ ...await repository.detail(saved.id), capabilities: ['receipt:read'] })
    await actions.hydrate(form, saved.id)
    await expect(actions.saveForm(form, draft, 'save')).rejects.toThrow(/权限/)
    expect(repository.execute).not.toHaveBeenCalled()
    await actions.hydrate(form, saved.id)
    repository.execute.mockRejectedValueOnce(receiptProblem('unavailable', 'lost'))
    await expect(actions.saveForm(form, draft, 'save')).rejects.toThrow()
    repository.context.mockResolvedValueOnce({ ...await repository.context(), actorId: 'other' })
    await expect(actions.recover(form)).rejects.toThrow(/身份/)
    expect(form.pending).not.toBeNull()
    expect(values.size).toBe(1)
    expect(repository.resolve).not.toHaveBeenCalled()
    await actions.recover(form)
    expect(form.pending).toBeNull()
  })

  it('冲突读回最新资料但不前移版本；原提交已封存后明确保留本页输入才能采用新版本', async () => {
    const { actions, form, commands, repository } = fixture()
    const saved = commands.execute(command(), session)
    await actions.hydrate(form, saved.id)
    commands.execute(command({ id: saved.id, baseVersion: saved.version, commandId: 'other-tab', draft: { ...draft, note: '其他页签已修改' } }), session)
    let caught: unknown
    try {
      await actions.saveForm(form, { ...draft, note: '保留我的输入' }, 'save')
    }
    catch (cause) { caught = cause }
    expect(caught).toMatchObject({ name: 'ReceiptCommandConflict', latest: { record: { version: '2', draft: { note: '其他页签已修改' } } } })
    expect(form.baseVersion).toBe('1')
    expect(form.pending).toBeNull()
    expect(repository.detail).toHaveBeenCalledTimes(2)
    actions.adoptConflictVersion(form, (caught as { latest: ReceiptDetail }).latest)
    expect(form.baseVersion).toBe('2')
  })

  it('存储写入或删除读回不可靠均保留输入，禁止绕过原编号发送', async () => {
    const { actions, form, repository, storage } = fixture()
    await actions.hydrate(form, null)
    const set = storage.setItem
    storage.setItem = () => {}
    await expect(actions.saveForm(form, draft, 'submit')).rejects.toThrow(/存储/)
    expect(repository.execute).not.toHaveBeenCalled()
    storage.setItem = set
    storage.removeItem = () => {}
    await expect(actions.saveForm(form, draft, 'submit')).rejects.toThrow(/已保存待刷新/)
    expect(form.pending?.result).not.toBeNull()
    await expect(actions.saveForm(form, draft, 'submit')).rejects.toThrow(/已保存待刷新/)
    expect(repository.execute).toHaveBeenCalledTimes(1)
  })

  it('较新合法编辑读回不擅自推进原输入基线，提交后的输入保持可识别', async () => {
    const { actions, form, repository, commands } = fixture()
    const saved = commands.execute(command(), session)
    await actions.hydrate(form, saved.id)
    let finish!: () => void
    repository.execute.mockImplementationOnce(async (request) => {
      const result = commands.execute(request, session)
      commands.execute(command({ id: result.id, baseVersion: result.version, commandId: 'later-legal', draft: { ...draft, note: '后续合法修改' } }), session)
      await new Promise<void>(resolve => finish = resolve)
      return result
    })
    const input = { ...draft, note: '本次提交' }
    const writing = actions.saveForm(form, input, 'save')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    input.note = '提交后的新输入'
    finish()
    const result = await writing
    expect(result.retainedInput).toBe(true)
    expect(result.detail.record.version).toBe('3')
    expect(form.baseVersion).toBe('2')
    expect(input.note).toBe('提交后的新输入')
  })
})
