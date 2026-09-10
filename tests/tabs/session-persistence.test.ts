import type { RestorableTabPath } from '~/lib/tabs/restoration-contract'
import { describe, expect, it } from 'vitest'
import { captureTabSession, readTabSession, tabSessionStorageKey } from '~/lib/tabs/session-persistence'
import { initialTabsState, openTab } from '~/lib/tabs/tab-machine'

const scope = { workspaceId: 'workspace-a', actorId: 'actor-a' }
function inspect(fullPath: string): RestorableTabPath | null {
  return fullPath.startsWith('/project') && !fullPath.includes('/new')
    ? { fullPath, origin: fullPath.includes('origin=demo') ? 'demo' : null }
    : null
}

function opened(paths: string[]) {
  return paths.reduce((state, fullPath) => openTab(state, { fullPath, title: fullPath }).state, initialTabsState())
}

describe('浏览器页签描述持久化', () => {
  it('排除写态，只保存可恢复视图身份且写态活动项回退最近只读页', () => {
    const state = opened(['/project?status=active', '/project/p1?origin=demo', '/project/new'])
    const snapshot = captureTabSession(state, null, scope, 100, inspect)
    expect(snapshot.tabs.map(tab => tab.fullPath)).toEqual(['/project?status=active', '/project/p1?origin=demo'])
    expect(snapshot.activeKey).toBe('/project/p1')
    expect(snapshot.tabs[1]).toEqual({ key: '/project/p1', title: '/project/p1?origin=demo', fullPath: '/project/p1?origin=demo', origin: 'demo', targetVersion: 1, sourceVersion: null, updatedAt: 100, closable: true })
    expect(Object.keys(snapshot).sort()).toEqual(['activeKey', 'schemaVersion', 'scope', 'tabs'])
  })

  it('同路径 query 改变更新描述，关闭和批量关闭不留下旧描述', () => {
    const before = captureTabSession(opened(['/project?status=active', '/project/p1']), null, scope, 100, inspect)
    const after = captureTabSession(opened(['/project?status=closed']), before, scope, 200, inspect)
    expect(after.tabs).toHaveLength(1)
    expect(after.tabs[0]).toMatchObject({ key: '/project', fullPath: '/project?status=closed', updatedAt: 200 })
    expect(captureTabSession(initialTabsState(), after, scope, 300, inspect).tabs).toEqual([])
  })

  it('不因非活动页标题变化或当前页软刷新而把全部旧页签变成最近访问', () => {
    const state = opened(['/project/p1', '/project/p2'])
    const first = captureTabSession(state, null, scope, 100, inspect)
    first.tabs[0]!.sourceVersion = 'source-v1'
    const renamed = { ...state, tabs: state.tabs.map(tab => tab.key === '/project/p1' ? { ...tab, title: '项目甲' } : tab) }
    const next = captureTabSession(renamed, first, scope, 200, inspect)
    expect(next.tabs.map(tab => tab.updatedAt)).toEqual([100, 100])
    expect(next.tabs[0]).toMatchObject({ title: '项目甲', sourceVersion: 'source-v1' })
    const switched = captureTabSession({ ...renamed, activeKey: '/project/p1' }, next, scope, 300, inspect)
    expect(switched.tabs.map(tab => tab.updatedAt)).toEqual([300, 100])
  })

  it('损坏、未知版本和其他用户的记录安全回到首页并保留诊断', () => {
    for (const input of ['{broken', { schemaVersion: 99 }, { ...captureTabSession(opened(['/project']), null, scope, 100, inspect), scope: { ...scope, actorId: 'someone-else' } }]) {
      const result = readTabSession(input, scope, inspect)
      expect(result.snapshot.tabs).toEqual([])
      expect(result.snapshot.activeKey).toBe('home')
      expect(result.diagnostics.length).toBeGreaterThan(0)
    }
    expect(readTabSession(null, scope, inspect).diagnostics).toEqual([])
    expect(tabSessionStorageKey(scope)).not.toBe(tabSessionStorageKey({ ...scope, actorId: 'another' }))
  })

  it('恢复去重并按更新时间保留最近15个，保持保留页签原来的排列', () => {
    const original = captureTabSession(opened(['/project/p0']), null, scope, 100, inspect)
    original.tabs = Array.from({ length: 18 }, (_, index) => ({ ...original.tabs[0]!, key: `/project/p${index}`, fullPath: `/project/p${index}`, title: `项目${index}`, updatedAt: index + 1 }))
    original.tabs.push({ ...original.tabs[5]!, fullPath: '/project/p5?status=active', updatedAt: 30 })
    original.activeKey = '/project/p0'
    const result = readTabSession(JSON.stringify(original), scope, inspect)
    expect(result.snapshot.tabs).toHaveLength(15)
    expect(result.snapshot.tabs.slice(0, 3).map(tab => tab.key)).toEqual(['/project/p3', '/project/p4', '/project/p6'])
    expect(result.snapshot.tabs.at(-1)).toMatchObject({ key: '/project/p5', fullPath: '/project/p5?status=active' })
    expect(result.snapshot.activeKey).toBe('/project/p5')
    expect(result.diagnostics).toEqual(expect.arrayContaining([{ reason: 'duplicate', count: 1 }, { reason: 'limit', count: 3 }]))
  })

  it('拒绝被篡改的key、来源和不可恢复路径，保留协议过期项交给验证器解释', () => {
    const snapshot = captureTabSession(opened(['/project/p1', '/project/p2', '/project/p3', '/project/p4']), null, scope, 100, inspect)
    snapshot.tabs[0]!.key = '/project/other'
    snapshot.tabs[1]!.origin = 'demo'
    snapshot.tabs[2]!.fullPath = '/project/new'
    snapshot.tabs[3]!.targetVersion = 0
    const result = readTabSession(snapshot, scope, inspect)
    expect(result.snapshot.tabs.map(tab => tab.key)).toEqual(['/project/p4'])
    expect(result.snapshot.tabs[0]!.targetVersion).toBe(0)
    expect(result.diagnostics).toEqual([{ reason: 'invalid-tab', count: 3 }])
  })
})
