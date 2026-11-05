import { describe, expect, it } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage, hasInvoiceMigrationStartupRecovery } from '../../app/lib/forms/command-recovery'

function memoryStorage(): Storage {
  const db = new Map<string, string>()
  return {
    get length() { return db.size },
    key: (index: number) => [...db.keys()][index] ?? null,
    getItem: (key: string) => db.get(key) ?? null,
    setItem: (key: string, value: string) => { db.set(key, value) },
    removeItem: (key: string) => { db.delete(key) },
    clear: () => db.clear(),
  }
}

describe('发票迁入刷新恢复', () => {
  it('仅保留当前身份的发布或批次撤回原编号，并拒绝其他路径与来源', () => {
    const storage = memoryStorage()
    const scope = { workspaceId: 'workspace', actorId: 'actor' }
    const publish = { ...scope, family: 'invoice-legacy', targetId: null, action: 'publish', commandId: 'publish-1', sourceSha256: 'a'.repeat(64) }
    const retire = { ...scope, family: 'invoice-legacy', targetId: 'batch-1', action: 'retire', commandId: 'retire-1' }
    const recovery = createCommandRecoveryStorage(() => storage)
    recovery.remember(commandRecoveryKey(retire), retire)
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration', scope, storage)).toBe(true)
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration?origin=demo', scope, storage)).toBe(false)
    expect(hasInvoiceMigrationStartupRecovery('/settings/other', scope, storage)).toBe(false)
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration', { ...scope, actorId: 'other' }, storage)).toBe(false)
    recovery.clear(commandRecoveryKey(retire), retire.commandId)
    recovery.remember(commandRecoveryKey(publish), publish)
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration', scope, storage)).toBe(true)
    expect(recovery.read(commandRecoveryKey(publish))).toEqual(publish)
    storage.setItem(commandRecoveryKey(publish), '{')
    expect(() => hasInvoiceMigrationStartupRecovery('/settings/data-migration', scope, storage)).toThrow('无法可靠核对原提交编号，请保留输入并恢复浏览器存储。')
    expect(storage.getItem(commandRecoveryKey(publish))).toBe('{')
  })

  it.each(['invalid-json', 'invalid-source', 'identity-mismatch'] as const)('同身份的 %s 原编号阻断恢复并完整保留原值', (damage) => {
    const storage = memoryStorage()
    const scope = { workspaceId: 'workspace', actorId: 'actor' }
    const publish = { ...scope, family: 'invoice-legacy', targetId: null, action: 'publish', commandId: 'publish-1', sourceSha256: 'a'.repeat(64) }
    const key = commandRecoveryKey(publish)
    const raw = damage === 'invalid-json'
      ? '{broken'
      : JSON.stringify(damage === 'invalid-source' ? { ...publish, sourceSha256: 'A'.repeat(64) } : { ...publish, actorId: 'other' })
    storage.setItem(key, raw)
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration?origin=demo', scope, storage)).toBe(false)
    expect(hasInvoiceMigrationStartupRecovery('/settings/other', scope, storage)).toBe(false)
    expect(() => hasInvoiceMigrationStartupRecovery('/settings/data-migration', scope, storage)).toThrow('无法可靠核对原提交编号，请保留输入并恢复浏览器存储。')
    expect(storage.getItem(key)).toBe(raw)
    expect(storage.length).toBe(1)
  })

  it('其他身份或命令族的损坏原编号不影响当前身份，也不被清除', () => {
    const storage = memoryStorage()
    const scope = { workspaceId: 'workspace', actorId: 'actor' }
    const foreignKey = commandRecoveryKey({ ...scope, actorId: 'another', family: 'invoice-legacy', targetId: null })
    const otherFamilyKey = commandRecoveryKey({ ...scope, family: 'finance-invoice', targetId: null })
    storage.setItem(foreignKey, '{foreign')
    storage.setItem(otherFamilyKey, '{other-family')
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration', scope, storage)).toBe(false)
    const retire = { ...scope, family: 'invoice-legacy', targetId: 'batch-1', action: 'retire', commandId: 'retire-1' }
    createCommandRecoveryStorage(() => storage).remember(commandRecoveryKey(retire), retire)
    expect(hasInvoiceMigrationStartupRecovery('/settings/data-migration?origin=real', scope, storage)).toBe(true)
    expect(storage.getItem(foreignKey)).toBe('{foreign')
    expect(storage.getItem(otherFamilyKey)).toBe('{other-family')
    expect(storage.length).toBe(3)
  })
})
