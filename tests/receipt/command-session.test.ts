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
  const repository = {
    context: vi.fn(async () => read.context(session)),
    detail: vi.fn(async (id: string) => read.detail(id, { origin: 'real' }, session)),
    execute: vi.fn(async (request: ReceiptCommand) => commands.execute(request, session)),
  }
  const actions = createReceiptCommandActions(() => repository)
  return { commands, repository, actions, form: actions.createSession() }
}

describe('收款表单命令会话', () => {
  it('读取未成功时不能写，成功后保存立即采用返回版本且不依赖再次详情读取', async () => {
    const { actions, form, repository } = fixture()
    await expect(actions.saveForm(form, draft, 'draft')).rejects.toThrow(/读取/)
    repository.context.mockRejectedValueOnce(receiptProblem('unavailable', '读取失败'))
    await expect(actions.hydrate(form, null)).rejects.toThrow(/读取失败/)
    await expect(actions.saveForm(form, draft, 'draft')).rejects.toThrow(/读取/)
    await actions.hydrate(form, null)
    const result = await actions.saveForm(form, draft, 'submit')
    expect(form).toMatchObject({ targetId: result.id, baseVersion: result.version, pending: null, busy: false })
    expect(repository.detail).not.toHaveBeenCalled()
    await actions.saveForm(form, { ...draft, note: '保存后继续编辑' }, 'save')
    expect(repository.execute.mock.calls[1]![0]).toMatchObject({ id: result.id, baseVersion: result.version })
  })

  it('服务已保存但响应丢失，原内容重试复用命令且不会重复新建；内容更改获得新编号', async () => {
    const { actions, form, repository, commands } = fixture()
    await actions.hydrate(form, null)
    repository.execute.mockImplementationOnce(async (request) => {
      commands.execute(request, session)
      throw receiptProblem('unavailable', '响应丢失')
    })
    const input = { ...draft }
    await expect(actions.saveForm(form, input, 'submit')).rejects.toThrow(/响应丢失/)
    const result = await actions.saveForm(form, input, 'submit')
    expect(repository.execute.mock.calls[0]![0].commandId).toBe(repository.execute.mock.calls[1]![0].commandId)
    expect(commands.facts().rows).toHaveLength(1)
    expect(form.baseVersion).toBe(result.version)
    repository.execute.mockRejectedValueOnce(receiptProblem('unavailable', '网络错误'))
    await expect(actions.saveForm(form, input, 'save')).rejects.toThrow()
    const previous = repository.execute.mock.calls.at(-1)![0].commandId
    await actions.saveForm(form, { ...input, note: '不同内容' }, 'save')
    expect(repository.execute.mock.calls.at(-1)![0].commandId).not.toBe(previous)
  })

  it('在途内容固定、阻止并发保存，旧表单返回不覆盖新会话', async () => {
    const { actions, form, repository } = fixture()
    await actions.hydrate(form, null)
    let finish!: (value: Awaited<ReturnType<typeof repository.execute>>) => void
    repository.execute.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const input = { ...draft }
    const writing = actions.saveForm(form, input, 'submit')
    input.note = '请求后的编辑'
    expect(repository.execute.mock.calls[0]![0].draft.note).toBe(draft.note)
    await expect(actions.saveForm(form, input, 'submit')).rejects.toThrow(/保存/)
    await actions.hydrate(form, null)
    finish({ id: 'old', commandId: repository.execute.mock.calls[0]![0].commandId, version: '1', updatedAt: '', attachmentIds: [] })
    await writing
    expect(form).toMatchObject({ targetId: null, baseVersion: null, busy: false })
  })

  it('迟到读取不会将另一张收款的版本或草稿交给当前表单', async () => {
    const { actions, form, repository, commands } = fixture()
    const saved = commands.execute(command(), session)
    const actual = await repository.detail(saved.id)
    let finish!: (value: ReceiptDetail) => void
    repository.detail.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const old = actions.hydrate(form, saved.id)
    await actions.hydrate(form, null)
    finish(actual)
    expect(await old).toBeNull()
    expect(form.targetId).toBeNull()
  })

  it('没有写权限或关联被隐藏的详情不能通过表单会话保存', async () => {
    const { actions, form, repository, commands } = fixture()
    const saved = commands.execute(command(), session)
    repository.detail.mockResolvedValueOnce({ ...await repository.detail(saved.id), capabilities: ['receipt:read'] })
    await actions.hydrate(form, saved.id)
    await expect(actions.saveForm(form, draft, 'save')).rejects.toThrow(/权限/)
    expect(repository.execute).not.toHaveBeenCalled()
  })

  it('冲突立即读回最新资料但不擅自前移版本，明确保留本页内容后才能采用新版本', async () => {
    const { actions, form, commands, repository } = fixture()
    const saved = commands.execute(command(), session)
    await actions.hydrate(form, saved.id)
    commands.execute(command({ id: saved.id, baseVersion: saved.version, commandId: 'other-tab', draft: { ...draft, note: '其他页签已修改' } }), session)
    await expect(actions.saveForm(form, { ...draft, note: '保留我的输入' }, 'save')).rejects.toMatchObject({ name: 'ReceiptCommandConflict', latest: { record: { version: '2', draft: { note: '其他页签已修改' } } } })
    expect(form.baseVersion).toBe('1')
    expect(repository.detail).toHaveBeenCalledTimes(2)
  })
})
