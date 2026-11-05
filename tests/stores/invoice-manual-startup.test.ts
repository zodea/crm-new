// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { commandRecoveryFormTarget, commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { tabSessionStorageKey } from '~/lib/tabs/session-persistence'
import { useTabSessionStore } from '~/stores/tab-session'

const scope = { workspaceId: 'manual-workspace', actorId: 'manual-actor' }
const path = '/finance/invoice/manual-new'
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(tabSessionStorageKey(scope), JSON.stringify({ schemaVersion: 1, scope, activeKey: '/project', tabs: [{ key: '/project', fullPath: '/project', title: '项目', origin: null, targetVersion: 1, sourceVersion: null, updatedAt: 1, closable: true }] }))
})
afterEach(() => useTabSessionStore().dispose())

it('仅当前身份的手工创建原编号保留精确刷新路由，不持久化写态', async () => {
  const session = useTabSessionStore()
  session.initialize({ scope, storage: localStorage, validate: async tab => ({ state: 'resolved', title: '项目', fullPath: tab.fullPath, sourceVersion: 'v1' }) })
  expect(await session.startupPath(path, true)).toBe('/project')
  const descriptor = { ...scope, family: 'finance-invoice', targetId: null, action: 'manual', commandId: 'manual-original' }
  createCommandRecoveryStorage().remember(commandRecoveryKey(descriptor), descriptor)
  expect(commandRecoveryFormTarget(path)).toEqual({ family: 'finance-invoice', targetId: null })
  expect(await session.startupPath(path, true)).toBe(path)
  session.finishStartup(path)
  expect(JSON.parse(localStorage.getItem(tabSessionStorageKey(scope))!).tabs.some((tab: { fullPath: string }) => tab.fullPath === path)).toBe(false)
  expect(await session.startupPath(`${path}?invoice=invoice-one`, true)).toBe('/project')
  expect(await session.startupPath(`${path}?origin=demo`, true)).toBe('/project')
  expect(await session.startupPath('/finance/invoice/other', true)).toBe('/project')
  expect(createCommandRecoveryStorage().read(commandRecoveryKey(descriptor))).toEqual(descriptor)
})

it.each(['upload', 'save-draft', 'submit'])('其他发票动作 %s 不可借手工新建路由保留写态', async (action) => {
  const session = useTabSessionStore()
  session.initialize({ scope, storage: localStorage, validate: async tab => ({ state: 'resolved', title: '项目', fullPath: tab.fullPath, sourceVersion: 'v1' }) })
  const descriptor = { ...scope, family: 'finance-invoice', targetId: null, action, commandId: 'other-command' }
  createCommandRecoveryStorage().remember(commandRecoveryKey(descriptor), descriptor)
  expect(await session.startupPath(path, true)).toBe('/project')
})

it('其他身份的手工原编号不会改变当前身份的刷新位置', async () => {
  const session = useTabSessionStore()
  session.initialize({ scope, storage: localStorage, validate: async tab => ({ state: 'resolved', title: '项目', fullPath: tab.fullPath, sourceVersion: 'v1' }) })
  const descriptor = { ...scope, actorId: 'another-actor', family: 'finance-invoice', targetId: null, action: 'manual', commandId: 'foreign-command' }
  createCommandRecoveryStorage().remember(commandRecoveryKey(descriptor), descriptor)
  expect(await session.startupPath(path, true)).toBe('/project')
  expect(createCommandRecoveryStorage().read(commandRecoveryKey(descriptor))).toEqual(descriptor)
})
