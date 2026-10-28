// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { readBoqRecoveryForRoute } from '../../app/lib/boq/command-recovery'
import { commandRecoveryKey, createCommandRecoveryStorage } from '../../app/lib/forms/command-recovery'

const identity = { workspaceId: 'boq-workspace', actorId: 'boq-owner' }
beforeEach(() => sessionStorage.clear())
it('startup只读取独立实际project/Main locator对应的原号；单project查询不能误恢复别项目', () => {
  const codec = createCommandRecoveryStorage()
  const one = { ...identity, family: 'boq', commandId: 'boq-original-one', action: 'import-file', scopeId: 'project-one:contract-one', targetId: 'import:project-one:contract-one' }
  const sibling = { ...one, commandId: 'boq-original-sibling', scopeId: 'project-one:contract-other', targetId: 'import:project-one:contract-other' }
  const outside = { ...one, commandId: 'boq-original-other', scopeId: 'project-other:contract-outside', targetId: 'import:project-other:contract-outside' }
  for (const marker of [one, sibling, outside]) codec.remember(commandRecoveryKey(marker), marker)
  const before = Object.entries(sessionStorage)
  expect(readBoqRecoveryForRoute('/contract/boq?project=project-one&origin=real', identity, sessionStorage)).toEqual([one, sibling])
  expect(readBoqRecoveryForRoute('/contract/boq/import?contract=contract-one', identity, sessionStorage)).toEqual([one])
  expect(readBoqRecoveryForRoute('/contract/boq/building-evidence?project=project-one&contract=contract-other', identity, sessionStorage)).toEqual([sibling])
  expect(readBoqRecoveryForRoute('/contract/boq', identity, sessionStorage)).toEqual([one, sibling, outside])
  expect(Object.entries(sessionStorage)).toEqual(before)
})
it('来源切换、矛盾或重复locators、跨源URL、控制符与encoded路径均不参与恢复', () => {
  for (const url of ['https://outside/contract/boq', '//outside/contract/boq', '/\\outside/contract/boq', '/contract/boq?origin=demo', '/contract/boq?origin=real&origin=real', '/contract/boq?project=project-one&projectId=project-one', '/contract/boq?project=project-one&pid=project-two', '/contract/boq?contract=contract-one&contractId=contract-one', '/contract/boq?project=project%2Fone', '/contract/boq%2Fimport', '/contract/boq%5Cimport', '/contract/boq\u0000']) expect(readBoqRecoveryForRoute(url, identity, sessionStorage)).toEqual([])
})
it('本actor marker损坏时保原存储停止恢复，不忽略它或清掉另一Main的原号', () => {
  const codec = createCommandRecoveryStorage()
  const marker = { ...identity, family: 'boq', commandId: 'boq-kept-original', action: 'patch-line', scopeId: 'project-one:contract-one', targetId: 'boq-line-one' }
  codec.remember(commandRecoveryKey(marker), marker)
  sessionStorage.setItem(commandRecoveryKey(marker), '{broken')
  expect(() => readBoqRecoveryForRoute('/contract/boq?project=project-one', identity, sessionStorage)).toThrow()
  expect(sessionStorage.getItem(commandRecoveryKey(marker))).toBe('{broken')
})
