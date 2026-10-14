// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../../app/lib/forms/command-recovery'
import { quantityRouteRecoveryScopes, readQuantityRecoveryForRoute } from '../../app/lib/quantity/command-recovery'

it('工程量恢复只读匹配原project/unit/record，拒绝跨源或含糊URL，不清理其他标记', () => {
  sessionStorage.clear()
  const codec = createCommandRecoveryStorage()
  const identity = { workspaceId: 'workspace', actorId: 'owner' }
  const first = { ...identity, commandId: 'completion-original-a', family: 'quantity', action: 'save-completion', scopeId: 'project', targetId: 'completion:project:unit:unit-a' }
  const other = { ...first, commandId: 'completion-original-b', targetId: 'completion:project:unit:unit-b' }
  const record = { ...first, commandId: 'hollow-original', action: 'revise-hollow-inspection', targetId: 'hollow:project:record:record-a' }
  for (const descriptor of [first, other, record]) codec.remember(commandRecoveryKey(descriptor), descriptor)
  const before = Object.entries(sessionStorage)
  expect(readQuantityRecoveryForRoute('/subcontract/quantity/project/unit-a?origin=real', identity, sessionStorage)).toEqual([first])
  expect(readQuantityRecoveryForRoute('/subcontract/quantity/project/unit-a/hollow/form/record-a?origin=real', identity, sessionStorage)).toEqual([record])
  for (const url of ['https://outside/subcontract/quantity/project/unit-a', '//outside/subcontract/quantity/project/unit-a', '/\\outside/subcontract/quantity/project/unit-a', '/subcontract/quantity/project/unit-a?origin=demo', '/subcontract/quantity/project/unit-a?origin=real&origin=real', '/subcontract/quantity/project/unit-a?project=other', '/subcontract/quantity/project/unit-a?project=project&pid=project', '/subcontract/quantity/project/unit%5Ca']) expect(quantityRouteRecoveryScopes(url)).toEqual([])
  expect(Object.entries(sessionStorage)).toEqual(before)
  sessionStorage.setItem(commandRecoveryKey(first), '{broken')
  expect(() => readQuantityRecoveryForRoute('/subcontract/quantity/project/unit-a', identity, sessionStorage)).toThrow()
  expect(sessionStorage.getItem(commandRecoveryKey(other))).not.toBeNull()
})
