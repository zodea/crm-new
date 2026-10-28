import type { CommandRecoveryDescriptor } from '../../app/lib/forms/command-recovery'
import { expect, it } from 'vitest'
import { readConstructionScopeStartupDescriptors } from '../../app/lib/construction-scope/startup-recovery'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../../app/lib/forms/command-recovery'

function storage() {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
  }
}
it('精确已保存父表单恢复多条原费用marker，隔离其他head/域/身份；畸形百分号/来源alias/路径拒绝且不删marker', () => {
  const db = storage()
  const actor = { workspaceId: 'scope-workspace', actorId: 'scope-owner' }
  const descriptor: CommandRecoveryDescriptor = { ...actor, family: 'construction-scope', action: 'bind', commandId: 'original-scope-command', targetId: 'original-expense:original-line', scopeId: 'expense-head' }
  const recovery = createCommandRecoveryStorage(() => db)
  recovery.remember(commandRecoveryKey(descriptor), descriptor)
  const other = { ...descriptor, commandId: 'other-scope-command', targetId: 'original-expense:other-line', scopeId: 'other-head' }
  recovery.remember(commandRecoveryKey(other), other)
  expect(readConstructionScopeStartupDescriptors('/finance/reimbursement/expense-head?origin=real', actor, db)).toEqual([descriptor])
  const before = [...Array.from({ length: db.length }, (_value, index) => [db.key(index), db.getItem(db.key(index)!)])]
  for (const path of ['/finance/reimbursement/%', '/finance/reimbursement/%2Fbad', '/finance/reimbursement/%00bad', '/finance/reimbursement/expense-head?origin=demo', '/finance/reimbursement/expense-head?origin=real&origin=real', '/finance/reimbursement/expense-head?origin=real&origin=demo', '//finance/reimbursement/expense-head', '/finance/reimbursement\\expense-head', '/contract/material/form/expense-head', '/finance/reimbursement/new'])
    expect(readConstructionScopeStartupDescriptors(path, actor, db)).toEqual([])
  expect(readConstructionScopeStartupDescriptors('/finance/reimbursement/expense-head', { ...actor, actorId: 'other-owner' }, db)).toEqual([])
  expect([...Array.from({ length: db.length }, (_value, index) => [db.key(index), db.getItem(db.key(index)!)])]).toEqual(before)
  const material = { ...descriptor, commandId: 'material-scope-command', targetId: 'material-contract:material-head', scopeId: 'material-head' }
  recovery.remember(commandRecoveryKey(material), material)
  expect(readConstructionScopeStartupDescriptors('/contract/material/form/material-head', actor, db)).toEqual([material])
  for (const [domain, path] of [['subcontract-contract', 'subcontract'], ['auxiliary-contract', 'other-expense']]) {
    const source = { ...descriptor, commandId: `${domain}-scope-command`, targetId: `${domain}:contract-head`, scopeId: 'contract-head' }
    recovery.remember(commandRecoveryKey(source), source)
    expect(readConstructionScopeStartupDescriptors(`/contract/${path}/form/contract-head`, actor, db)).toEqual([source])
    expect(readConstructionScopeStartupDescriptors('/contract/company-expense/form/contract-head', actor, db)).toEqual([])
    expect(readConstructionScopeStartupDescriptors(`/contract/${path}/form/%2Fcontract-head`, actor, db)).toEqual([])
  }
  const foreignMaterial = { ...material, commandId: 'forged-other-material', targetId: 'material-contract:foreign-head' }
  recovery.remember(commandRecoveryKey(foreignMaterial), foreignMaterial)
  expect(readConstructionScopeStartupDescriptors('/contract/material/form/material-head', actor, db)).toEqual([material])
})
