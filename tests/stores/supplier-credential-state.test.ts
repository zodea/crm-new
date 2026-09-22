import type { SupplierCredentialAction, SupplierCredentialCommand, SupplierCredentialRepository } from '~/lib/supplier/credential-contract'
import type { SupplierCredentialTarget } from '~/lib/supplier/credential-state'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { credentialProblem, SupplierCredentialNotAppliedProblem } from '~/lib/supplier/credential-contract'
import { createSupplierCredentialState } from '~/lib/supplier/credential-state'
import { credentialRecord, credentialSnapshot } from '../supplier/credential-ui-fixtures'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const action: SupplierCredentialAction = { action: 'review', draft: { decision: 'qualified', note: '已人工核对' } }
function setup() {
  const target = shallowRef<SupplierCredentialTarget>({ supplierId: 'supplier-a', origin: 'real', enabled: true })
  const read = vi.fn<SupplierCredentialRepository['read']>().mockResolvedValue(credentialSnapshot())
  const execute = vi.fn<SupplierCredentialRepository['execute']>().mockImplementation(async (command: SupplierCredentialCommand) => ({ commandId: command.commandId, supplierId: command.supplierId, credentialId: null, auditId: 'audit-a', deletionToken: null, supplierVersion: 'supplier-v2', credentialVersion: 'credential-v2' }))
  const file = vi.fn<SupplierCredentialRepository['file']>()
  let next = 0
  const state = createSupplierCredentialState({ read, execute, file }, () => target.value, () => `command-${++next}`)
  return { state, read, execute, file, setTarget: (next: SupplierCredentialTarget) => {
    target.value = next
  } }
}

describe('中央证照会话所有权和原提交恢复', () => {
  it('只有证照写权时可以识别，不能提交主档人工确认', async () => {
    const { state, execute } = setup()
    await state.load()
    await expect(state.execute({ action: 'ocr-confirm', credentialId: 'credential-a', draft: { decisions: { category: 'keep-current', longTerm: 'keep-current' }, recognitionId: 'recognition-a', choices: [], category: '营业执照', longTerm: false } })).rejects.toThrow(/主档/)
    expect(execute).not.toHaveBeenCalled()
  })
  it('a 读取迟到不覆盖已经读取的 B，同名主档也按 ID 隔离', async () => {
    const { state, read, setTarget } = setup()
    const old = deferred<ReturnType<typeof credentialSnapshot>>()
    read.mockReturnValueOnce(old.promise)
    const first = state.load()
    setTarget({ supplierId: 'supplier-b', origin: 'real', enabled: true })
    read.mockResolvedValueOnce(credentialSnapshot({ supplierId: 'supplier-b', supplierName: '合成分供方 A' }))
    await state.load()
    old.resolve(credentialSnapshot())
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(state.data.value?.supplierId).toBe('supplier-b')
  })

  it('响应丢失后重读也使用原 commandId 和基准，不重复产生证照', async () => {
    const { state, read, execute } = setup()
    await state.load()
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '响应丢失'))
    await expect(state.execute(action)).rejects.toThrow('响应丢失')
    const original = execute.mock.calls[0]![0]
    read.mockResolvedValue(credentialSnapshot({ supplierVersion: 'supplier-v2', credentialVersion: 'credential-v2' }))
    await state.load()
    await state.execute(action)
    expect(execute.mock.calls[1]![0]).toEqual(original)
  })
  it('已有不确定提交恢复时暂时无权，恢复权限后仍只能用原命令核验', async () => {
    const { state, execute } = setup()
    await state.load()
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '响应丢失'))
    await expect(state.execute(action)).rejects.toThrow('响应丢失')
    const original = execute.mock.calls[0]![0]
    execute.mockRejectedValueOnce(credentialProblem('forbidden', '临时撤权'))
    await expect(state.execute(action)).rejects.toThrow('临时撤权')
    await state.recheck()
    await state.execute(action)
    expect(execute.mock.calls[2]![0]).toEqual(original)
  })
  it('断网请求未到后台，恢复时获同命令未应用冲突证明后可保选择重新核对', async () => {
    const { state, read, execute } = setup()
    await state.load()
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '请求未送达'))
    await expect(state.execute(action)).rejects.toThrow()
    const original = execute.mock.calls[0]![0]
    execute.mockRejectedValueOnce(new SupplierCredentialNotAppliedProblem(original.commandId, '收据不存在且版本已变化', 'conflict'))
    await expect(state.execute(action)).rejects.toThrow(/版本已变化/)
    expect(state.hasPending(action)).toBe(false)
    expect(state.conflict.value).toBe(true)
    read.mockResolvedValue(credentialSnapshot({ supplierVersion: 's-new', credentialVersion: 'c-new' }))
    await state.recheck()
    await state.execute(action)
    expect(execute.mock.calls[2]![0].commandId).not.toBe(original.commandId)
  })

  it('写入成功而回读失败，重试仍恢复原提交', async () => {
    const { state, read, execute } = setup()
    await state.load()
    read.mockRejectedValueOnce(credentialProblem('unavailable', '回读失败'))
    await expect(state.execute(action)).rejects.toThrow('回读失败')
    await state.execute(action)
    expect(execute.mock.calls[1]![0].commandId).toBe(execute.mock.calls[0]![0].commandId)
  })
  it('首次命令已成功但回读无权，恢复也不能生成第二命令', async () => {
    const { state, read, execute } = setup()
    await state.load()
    read.mockRejectedValueOnce(credentialProblem('forbidden', '保存已完成，回读暂时无权'))
    await expect(state.execute(action)).rejects.toThrow(/回读暂时无权/)
    const first = execute.mock.calls[0]![0]
    await state.recheck()
    await state.execute(action)
    expect(execute.mock.calls[1]![0]).toEqual(first)
  })

  it('明确版本冲突后旧稿不能自动重试，重新核对才换新命令', async () => {
    const { state, read, execute } = setup()
    await state.load()
    const old = state.baseline()
    execute.mockRejectedValueOnce(credentialProblem('conflict', '主档或证照版本已变化'))
    await expect(state.execute(action, old)).rejects.toThrow('版本已变化')
    await expect(state.execute(action, old)).rejects.toThrow('重新核对')
    expect(execute).toHaveBeenCalledTimes(1)
    read.mockResolvedValue(credentialSnapshot({ supplierVersion: 'supplier-v2', credentialVersion: 'credential-v2' }))
    const next = await state.recheck()
    await state.execute(action, next)
    expect(execute.mock.calls[1]![0]).toMatchObject({ commandId: 'command-2', baseSupplierVersion: 'supplier-v2', baseCredentialVersion: 'credential-v2' })
  })

  it('上传途中切换来源，不执行迟到回读也不写另一来源', async () => {
    const { state, execute, read, setTarget } = setup()
    await state.load()
    const wait = deferred<Awaited<ReturnType<SupplierCredentialRepository['execute']>>>()
    execute.mockReturnValueOnce(wait.promise)
    const saving = state.execute(action)
    setTarget({ supplierId: 'supplier-a', origin: 'demo', enabled: true })
    state.cancelRead()
    wait.resolve({ commandId: 'command-1', supplierId: 'supplier-a', credentialId: null, auditId: null, deletionToken: null, supplierVersion: 's2', credentialVersion: 'c2' })
    await expect(saving).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(state.data.value).toBeNull()
    expect(state.canWrite.value).toBe(false)
  })

  it('未开启演示时不发读取，获准演示也不能写', async () => {
    const { state, read, execute, setTarget } = setup()
    setTarget({ supplierId: 'supplier-a', origin: 'demo', enabled: false })
    await state.load()
    expect(read).not.toHaveBeenCalled()
    setTarget({ supplierId: 'supplier-a', origin: 'demo', enabled: true })
    read.mockResolvedValue(credentialSnapshot({ dataOrigin: 'demo' }))
    await state.load()
    await expect(state.execute(action)).rejects.toThrow('写入权限')
    expect(execute).not.toHaveBeenCalled()
  })

  it('当前读取失败清除旧证照展示，不把失败作为真实空态', async () => {
    const { state, read } = setup()
    read.mockResolvedValueOnce(credentialSnapshot({ credentials: [credentialRecord()] }))
    await state.load()
    read.mockRejectedValueOnce(credentialProblem('forbidden', '无权读取'))
    await expect(state.load()).rejects.toThrow('无权读取')
    expect(state.data.value).toBeNull()
    expect(state.errorCode.value).toBe('forbidden')
  })

  it('返回页签时操作身份变化，旧草稿必须显式重新核对', async () => {
    const { state, read, execute } = setup()
    await state.load()
    const old = state.baseline()
    read.mockResolvedValue(credentialSnapshot({ actorId: 'actor-b' }))
    await state.load()
    await expect(state.execute(action, old)).rejects.toThrow('操作身份已变化')
    expect(state.conflict.value).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    const latest = await state.recheck()
    await state.execute(action, latest)
    expect(execute.mock.calls[0]![0].actorId).toBe('actor-b')
  })
})
