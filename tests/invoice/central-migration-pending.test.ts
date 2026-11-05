import { expect, it } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { createInvoiceMigrationSession } from '~/lib/invoice/central-migration'

it('迁入待核对编号仅显示已验证身份，撤权、切换身份及损坏存储均保留原编号并阻断', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:write', 'finance-invoice:import'] }
  let current = actor
  const data = new Map<string, string>()
  const storage = () => ({
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  })
  const recovery = createCommandRecoveryStorage(storage)
  const own = { workspaceId: actor.workspaceId, actorId: actor.actorId, family: 'invoice-legacy', targetId: null, action: 'publish', commandId: 'own-command', sourceSha256: 'a'.repeat(64) }
  const other = { ...own, actorId: 'actor-two', commandId: 'other-command' }
  const ownKey = commandRecoveryKey(own)
  recovery.remember(ownKey, own)
  recovery.remember(commandRecoveryKey(other), other)
  const session = createInvoiceMigrationSession({ identity: actor, verifiedIdentity: actor, context: async () => current, fetcher: async () => {
    throw new Error('不应读取业务数据')
  }, storage })
  expect(session.pendingAll()).toMatchObject([{ commandId: 'own-command' }])
  current = { ...actor, capabilities: ['finance-invoice:read'] }
  await expect(session.state()).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  expect(session.identityVerified()).toBe(false)
  expect(() => session.pendingAll()).toThrow('旧发票迁入回执或来源尚未可靠核对')
  expect(recovery.read(ownKey)?.commandId).toBe('own-command')
  current = { ...actor, actorId: 'actor-two' }
  await expect(session.state()).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  expect(recovery.read(ownKey)?.commandId).toBe('own-command')
  const authorized = createInvoiceMigrationSession({ identity: actor, verifiedIdentity: actor, context: async () => actor, fetcher: async () => ({}), storage })
  data.set(ownKey, '{broken')
  expect(() => authorized.pendingAll()).toThrow('无法可靠核对原提交编号')
  expect(data.get(ownKey)).toBe('{broken')
  expect(recovery.read(commandRecoveryKey(other))?.commandId).toBe('other-command')
})
