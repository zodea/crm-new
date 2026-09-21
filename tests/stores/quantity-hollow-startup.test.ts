// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { tabSessionStorageKey } from '~/lib/tabs/session-persistence'
import { useTabSessionStore } from '~/stores/tab-session'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})
it('刷新精确空鼓工作页保直接目标，仍不保存为可恢复只读页签', async () => {
  const scope = { workspaceId: 'hollow-work', actorId: 'hollow-actor' }
  const storageKey = tabSessionStorageKey(scope)
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, scope, activeKey: '/project', tabs: [{ key: '/project', fullPath: '/project', title: '项目', origin: null, targetVersion: 1, sourceVersion: null, updatedAt: 1, closable: true }] }))
  const session = useTabSessionStore()
  session.initialize({ scope, storage: localStorage, validate: async tab => ({ state: 'resolved', title: '当前项目', fullPath: tab.fullPath, sourceVersion: 'v1' }) })
  for (const path of ['/subcontract/quantity/project/unit/hollow/new?origin=real&draftKey=original-draft', '/subcontract/quantity/project/unit/hollow/form/original-record?origin=real']) {
    expect(await session.startupPath(path, true)).toBe(path)
    expect(inspectRestorableTabPath(path)).toBeNull()
    session.finishStartup(path)
    expect(JSON.parse(localStorage.getItem(storageKey)!).tabs.some((tab: { fullPath: string }) => tab.fullPath === path)).toBe(false)
  }
  for (const path of ['/project/new', '/subcontract/quantity/project/unit/hollow/new?origin=real&draftKey=x&draftKey=y', '/subcontract/quantity/project/unit/hollow/new?origin=demo&draftKey=x', '/subcontract/quantity/project/unit/hollow/new?origin=real&draftKey=x&returnTo=https://other.invalid/', '/subcontract/quantity/project/core-quantity_projects-bad/hollow/new?origin=real&draftKey=x'])
    expect(await session.startupPath(path, true)).toBe('/project')
})
