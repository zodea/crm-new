import type { SupplierTaxpayerCommand, SupplierTaxpayerResult } from '~/lib/supplier/taxpayer-verification'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { useSupplierCommandStore } from '~/stores/supplier-command'

const context = vi.fn()
const execute = vi.fn()
const loadForm = vi.fn()
const repositories = { supplierCommands: { context, recordTaxpayerVerification: execute, loadForm } }
const identity = { workspaceId: 'workspace', actorId: 'actor', capabilities: ['supplier:write'] }
const input = { supplierId: 'supplier-a', origin: 'real' as const, expectedTaxNo: 'TAX-A', baseSupplierVersion: '1', draft: { status: 'not_found' as const, taxpayerType: '小规模纳税人' as const, note: '人工核验输入' } }
const response = (command: SupplierTaxpayerCommand): SupplierTaxpayerResult => ({ commandId: command.commandId, supplierId: command.supplierId, supplierVersion: '2', credentialVersion: '1', credentialId: null, auditId: 'audit', deletionToken: null, verification: { taxpayerType: '未核验', taxpayerVerificationStatus: 'not_found', taxpayerVerificationSource: '官网', taxpayerVerifiedAt: '2026-09-12T12:00:00.000Z', taxpayerVerificationNote: command.draft.note } })
async function setup() {
  const store = useSupplierCommandStore()
  const session = store.createSession()
  await store.hydrate(session, 'supplier-a')
  return { store, session }
}
beforeEach(() => {
  setActivePinia(createPinia())
  context.mockReset().mockResolvedValue(identity)
  loadForm.mockReset().mockResolvedValue({ draft: { id: 'supplier-a', taxNo: 'TAX-A' }, version: '1' })
  execute.mockReset().mockImplementation(async command => response(command))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: repositories }))
})
describe('每表单税务提交身份', () => {
  it('响应丢失保留原 commandId，权限短暂撤回不丢失原提交', async () => {
    const { store, session } = await setup()
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '响应丢失'))
    await expect(store.recordTaxpayerVerification(session, input)).rejects.toThrow('响应丢失')
    const original = session.pendingTaxpayerCommand!.commandId
    context.mockResolvedValueOnce({ ...identity, capabilities: [] })
    await expect(store.recordTaxpayerVerification(session, input)).rejects.toThrow('写入权限')
    expect(session.pendingTaxpayerCommand?.commandId).toBe(original)
    await store.recordTaxpayerVerification(session, input)
    expect(execute.mock.calls.map(row => row[0].commandId)).toEqual([original, original])
    expect(session.baseVersion).toBe('2')
    expect(session.pendingTaxpayerCommand).toBeNull()
  })
  it('税务独立重读的新版本不替整页旧稿自动变基', async () => {
    const { store, session } = await setup()
    await store.recordTaxpayerVerification(session, { ...input, baseSupplierVersion: '8' })
    expect(session.baseVersion).toBe('1')
  })
  it('命令迟到不更新另一页签的主档版本，原页可恢复同命令', async () => {
    const { store, session } = await setup()
    let current = true
    let finish!: () => void
    execute.mockImplementationOnce((command: SupplierTaxpayerCommand) => new Promise((resolve) => {
      finish = () => resolve(response(command))
    }))
    const result = store.recordTaxpayerVerification(session, input, () => current)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    current = false
    finish()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(session.baseVersion).toBe('1')
    expect(session.pendingTaxpayerCommand).not.toBeNull()
    current = true
    await store.recordTaxpayerVerification(session, input, () => current)
    expect(execute.mock.calls[0]![0].commandId).toBe(execute.mock.calls[1]![0].commandId)
  })
  it('未确认税务提交不能被普通保存绕过，明确业务冲突后允许重读', async () => {
    const { store, session } = await setup()
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '响应丢失'))
    await expect(store.recordTaxpayerVerification(session, input)).rejects.toThrow()
    await expect(store.saveForm(session, { id: 'supplier-a' }, 'save')).rejects.toThrow('恢复')
    execute.mockRejectedValueOnce(credentialProblem('conflict', '主档版本变化'))
    await expect(store.recordTaxpayerVerification(session, input)).rejects.toThrow('版本变化')
    expect(session.pendingTaxpayerCommand).toBeNull()
  })
})
