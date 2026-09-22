import type { RestorableTabPath, TabDescriptor } from './restoration-contract'
import type { TabsState } from './tab-machine'
import { TAB_TARGET_VERSION } from './restoration-contract'
import { deriveKey, HOME_KEY, MAX_TABS } from './tab-machine'

export interface TabSessionScope {
  workspaceId: string
  actorId: string
}

export interface TabSessionSnapshot {
  schemaVersion: 1
  scope: TabSessionScope
  activeKey: string
  tabs: TabDescriptor[]
}

export interface TabSessionDiagnostic {
  reason: 'invalid-storage' | 'schema' | 'scope' | 'invalid-tab' | 'duplicate' | 'limit'
  count: number
}

type InspectPath = (fullPath: string) => RestorableTabPath | null

function emptySnapshot(scope: TabSessionScope): TabSessionSnapshot {
  return { schemaVersion: 1, scope: { workspaceId: scope.workspaceId, actorId: scope.actorId }, activeKey: HOME_KEY, tabs: [] }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mostRecentKey(tabs: TabDescriptor[]): string {
  return tabs.reduce<TabDescriptor | null>((recent, tab) => !recent || tab.updatedAt >= recent.updatedAt ? tab : recent, null)?.key ?? HOME_KEY
}

function trimToLimit(tabs: TabDescriptor[]): TabDescriptor[] {
  const retained = new Set([...tabs].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_TABS).map(tab => tab.key))
  return tabs.filter(tab => retained.has(tab.key))
}

export function tabSessionStorageKey(scope: TabSessionScope): string {
  return `ruihang:tab-session:v1:${encodeURIComponent(scope.workspaceId)}:${encodeURIComponent(scope.actorId)}`
}

function readDescriptor(value: unknown, inspect: InspectPath): TabDescriptor | null {
  if (!object(value) || typeof value.fullPath !== 'string' || typeof value.title !== 'string'
    || value.title.length > 200 || !Number.isSafeInteger(value.updatedAt) || Number(value.updatedAt) < 0
    || !Number.isSafeInteger(value.targetVersion) || Number(value.targetVersion) < 0 || value.closable !== true
    || (value.sourceVersion !== null && (typeof value.sourceVersion !== 'string' || value.sourceVersion.length > 512))) {
    return null
  }
  const path = inspect(value.fullPath)
  if (!path || path.fullPath === '/' || value.key !== deriveKey(path.fullPath) || value.origin !== path.origin)
    return null
  return {
    key: deriveKey(path.fullPath),
    title: value.title.trim() || path.fullPath,
    fullPath: path.fullPath,
    origin: path.origin,
    targetVersion: Number(value.targetVersion),
    sourceVersion: value.sourceVersion as string | null,
    updatedAt: Number(value.updatedAt),
    closable: true,
  }
}

/** 结构迁移不读取业务记录；未激活的详情仍保持懒加载。 */
export function readTabSession(input: unknown, scope: TabSessionScope, inspect: InspectPath): {
  snapshot: TabSessionSnapshot
  diagnostics: TabSessionDiagnostic[]
} {
  const empty = emptySnapshot(scope)
  const fail = (reason: TabSessionDiagnostic['reason']) => ({ snapshot: empty, diagnostics: [{ reason, count: 1 }] })
  if (input == null || input === '')
    return { snapshot: empty, diagnostics: [] }
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    }
    catch {
      return fail('invalid-storage')
    }
  }
  if (!object(raw))
    return fail('invalid-storage')
  if (raw.schemaVersion !== 1)
    return fail('schema')
  if (!object(raw.scope) || raw.scope.workspaceId !== scope.workspaceId || raw.scope.actorId !== scope.actorId)
    return fail('scope')
  if (!Array.isArray(raw.tabs))
    return fail('invalid-storage')

  const diagnostics: TabSessionDiagnostic[] = []
  const unique = new Map<string, { tab: TabDescriptor, index: number }>()
  let invalid = 0
  let duplicates = 0
  raw.tabs.forEach((value, index) => {
    const tab = readDescriptor(value, inspect)
    if (!tab) {
      invalid += 1
      return
    }
    const previous = unique.get(tab.key)
    if (previous)
      duplicates += 1
    if (!previous || tab.updatedAt >= previous.tab.updatedAt)
      unique.set(tab.key, { tab, index })
  })
  const ordered = [...unique.values()].sort((left, right) => left.index - right.index).map(item => item.tab)
  const tabs = trimToLimit(ordered)
  if (invalid)
    diagnostics.push({ reason: 'invalid-tab', count: invalid })
  if (duplicates)
    diagnostics.push({ reason: 'duplicate', count: duplicates })
  if (ordered.length > tabs.length)
    diagnostics.push({ reason: 'limit', count: ordered.length - tabs.length })
  const activeKey = raw.activeKey === HOME_KEY || tabs.some(tab => tab.key === raw.activeKey)
    ? String(raw.activeKey)
    : mostRecentKey(tabs)
  return { snapshot: { ...empty, tabs, activeKey }, diagnostics }
}

/** 关闭后的集合直接取当前状态，不能把旧存储中的已关闭描述符合并回来。 */
export function captureTabSession(
  state: TabsState,
  previous: TabSessionSnapshot | null,
  scope: TabSessionScope,
  now: number,
  inspect: InspectPath,
): TabSessionSnapshot {
  const matchingScope = previous?.scope.workspaceId === scope.workspaceId && previous.scope.actorId === scope.actorId
    ? previous
    : null
  const previousTabs = new Map(matchingScope?.tabs.map(tab => [tab.key, tab]))
  const tabs = trimToLimit(state.tabs.flatMap((tab): TabDescriptor[] => {
    if (!tab.closable || tab.key === HOME_KEY)
      return []
    const path = inspect(tab.fullPath)
    if (!path)
      return []
    const key = deriveKey(path.fullPath)
    const before = previousTabs.get(key)
    const samePath = before?.fullPath === path.fullPath && before.origin === path.origin
    const newlyActivated = state.activeKey === key && matchingScope?.activeKey !== key
    return [{
      key,
      title: tab.title.trim().slice(0, 200) || path.fullPath,
      fullPath: path.fullPath,
      origin: path.origin,
      targetVersion: samePath ? before.targetVersion : TAB_TARGET_VERSION,
      sourceVersion: samePath ? before.sourceVersion : null,
      updatedAt: samePath && !newlyActivated ? before.updatedAt : now,
      closable: true,
    }]
  }))
  const activeKey = state.activeKey === HOME_KEY || tabs.some(tab => tab.key === state.activeKey)
    ? state.activeKey
    : mostRecentKey(tabs)
  return { ...emptySnapshot(scope), tabs, activeKey }
}
