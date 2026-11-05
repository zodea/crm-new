import type { InvoiceCorrectionDraft, InvoiceCorrectionSaveCommand } from '../../app/lib/invoice/correction-contract'
import { expect, it, vi } from 'vitest'
import { commandRecoveryFormTarget } from '../../app/lib/forms/command-recovery'
import { createInvoiceCorrectionSession } from '../../app/lib/invoice/correction-session'

it('更正结果未知或保存后回读失败时保留原编号，恢复成功才允许新操作', async () => {
  const data = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  })
  const identity = { workspaceId: 'workspace-1', actorId: 'actor-1', capabilities: ['finance-invoice:write'] }
  const result = { commandId: 'command-1', correctionId: 'correction-1', invoiceId: 'invoice-1', version: '1', updatedAt: '2026-11-05T00:00:00.000Z' }
  const correction = { id: result.correctionId, invoiceId: result.invoiceId, version: result.version } as InvoiceCorrectionDraft
  const get = vi.fn().mockRejectedValueOnce(new Error('回读断开')).mockResolvedValue(correction)
  const repository = { save: vi.fn().mockRejectedValueOnce(new Error('连接中断')), submit: vi.fn(), get, resolve: vi.fn().mockResolvedValue({ outcome: 'applied', result }) }
  const session = createInvoiceCorrectionSession({ identity, invoiceId: 'invoice-1', repository, invoiceVersion: async () => '1', context: async () => ({ ...identity, capabilities: ['finance-invoice:write'] }), storage })
  const command = { workspaceId: identity.workspaceId, actorId: identity.actorId, action: 'save-draft', commandId: 'command-1', invoiceId: 'invoice-1', correctionId: null } as InvoiceCorrectionSaveCommand
  await expect(session.execute(command)).rejects.toThrow('连接中断')
  expect(session.pending()).toMatchObject({ commandId: 'command-1', scopeId: 'new' })
  await expect(session.recover()).rejects.toThrow('回读断开')
  expect(session.pending()?.commandId).toBe('command-1')
  await expect(session.recover()).resolves.toMatchObject({ outcome: 'applied', correction })
  expect(session.pending()).toBeNull()
  expect(repository.resolve).toHaveBeenCalledWith({ workspaceId: identity.workspaceId, actorId: identity.actorId, action: 'save-draft', commandId: 'command-1', invoiceId: 'invoice-1', correctionId: null })
  expect(commandRecoveryFormTarget('/finance/invoice/correction/invoice-1')).toEqual({ family: 'finance-invoice', targetId: 'invoice-1' })
  expect(commandRecoveryFormTarget('/finance/invoice/correction/%2F')).toBeNull()
})
