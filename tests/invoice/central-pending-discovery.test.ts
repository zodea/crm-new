import { expect, it, vi } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { createCentralInvoiceSession, pendingCentralInvoiceCommands } from '~/lib/invoice/central-session'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

it('只发现当前身份的原命令，损坏或动作无法辨认时阻断', () => {
  const store = memoryStorage()
  const recovery = createCommandRecoveryStorage(() => store)
  const scope = { workspaceId: 'workspace-one', actorId: 'actor-one', family: 'finance-invoice', targetId: 'invoice-one' }
  const other = { ...scope, actorId: 'actor-two', targetId: 'invoice-two' }
  recovery.remember(commandRecoveryKey(scope), { ...scope, action: 'discard', commandId: 'discard-one' })
  recovery.remember(commandRecoveryKey(other), { ...other, action: 'restore', commandId: 'restore-two' })
  expect(pendingCentralInvoiceCommands(scope, () => store)).toMatchObject([{ ...scope, commandId: 'discard-one' }])
  store.setItem(commandRecoveryKey(scope), '{broken')
  expect(() => pendingCentralInvoiceCommands(scope, () => store)).toThrow('无法可靠核对原提交编号')
  expect(store.getItem(commandRecoveryKey(scope))).toBe('{broken')
  store.setItem(commandRecoveryKey(scope), JSON.stringify({ ...scope, action: 'unknown', commandId: 'discard-one' }))
  expect(() => pendingCentralInvoiceCommands(scope, () => store)).toThrow('无法可靠核对原提交编号')
  expect(store.getItem(commandRecoveryKey(scope))).toContain('unknown')
  expect(pendingCentralInvoiceCommands(other, () => store)).toMatchObject([{ ...other, commandId: 'restore-two' }])
})

it('更正原编号不能交给普通发票 resolve，撤权也不能清除原编号', async () => {
  const store = memoryStorage()
  const identity = { workspaceId: 'workspace-one', actorId: 'actor-one' }
  const scope = { ...identity, family: 'finance-invoice', targetId: 'invoice-one' }
  const key = commandRecoveryKey(scope)
  const recovery = createCommandRecoveryStorage(() => store)
  recovery.remember(key, { ...scope, action: 'submit', scopeId: 'correction-one', commandId: 'correction-command' })
  const resolve = vi.fn()
  let capabilities = ['finance-invoice:read', 'finance-invoice:write']
  const session = createCentralInvoiceSession({ identity, targetId: scope.targetId, storage: () => store, context: async () => ({ ...identity, capabilities }), repository: { resolve, execute: vi.fn(), get: vi.fn() } })
  expect(pendingCentralInvoiceCommands(identity, () => store)).toMatchObject([{ action: 'submit', scopeId: 'correction-one', targetId: 'invoice-one' }])
  await expect(session.recover()).rejects.toThrow('先回原页面核对')
  expect(resolve).not.toHaveBeenCalled()
  expect(recovery.read(key)?.commandId).toBe('correction-command')
  store.removeItem(key)
  recovery.remember(key, { ...scope, action: 'discard', commandId: 'discard-command' })
  capabilities = []
  await expect(session.recover()).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  expect(resolve).not.toHaveBeenCalled()
  expect(recovery.read(key)?.commandId).toBe('discard-command')
})
