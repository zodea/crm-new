import type { Ref } from 'vue'
import type { TabRestoreResult, TabRestoreValidator } from '~/lib/tabs/restoration-contract'
import type { TabSessionDiagnostic, TabSessionScope, TabSessionSnapshot } from '~/lib/tabs/session-persistence'
import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { effectScope, onScopeDispose, shallowRef, watch } from 'vue'
import { readBoqRecoveryForRoute, readBoqSourceImportRecoveryForRoute } from '~/lib/boq/command-recovery'
import { readConstructionScopeStartupDescriptors } from '~/lib/construction-scope/startup-recovery'
import { commandRecoveryKey, commandRecoveryRouteTargets, commandRecoveryStorageForFamily } from '~/lib/forms/command-recovery'
import { readPayrollStartupDescriptors } from '~/lib/payroll/startup-recovery'
import { readQuantityRecoveryForRoute } from '~/lib/quantity/command-recovery'
import { isQuantityHollowWorkPath } from '~/lib/quantity/hollow-navigation'
import { SCHEDULE_COMMAND_RECOVERY_ACTIONS } from '~/lib/schedule/command-recovery'
import { TAB_TARGET_VERSION } from '~/lib/tabs/restoration-contract'
import { createTabSessionRestorer } from '~/lib/tabs/restore-session'
import { inspectRestorableTabPath } from '~/lib/tabs/restore-target'
import { captureTabSession, readTabSession, tabSessionStorageKey } from '~/lib/tabs/session-persistence'
import { deriveKey, HOME_KEY, MAX_TABS } from '~/lib/tabs/tab-machine'
import { routeTitle } from '~/lib/tabs/tab-title'
import { useTabsStore } from '~/stores/tabs'

type Problem = Exclude<TabRestoreResult, { state: 'resolved' }> & { key: string, title: string, fullPath: string }
interface InitializeOptions {
  scope: TabSessionScope
  storage: Storage
  validate: TabRestoreValidator
}
const scheduleRecoveryActions: ReadonlySet<string> = new Set(SCHEDULE_COMMAND_RECOVERY_ACTIONS)

export const useTabSessionStore = defineStore('tab-session', () => {
  const tabs = useTabsStore()
  const problems = shallowRef<Problem[]>([])
  const diagnostics = shallowRef<TabSessionDiagnostic[]>([])
  const loadingKey = shallowRef<string | null>(null)
  const storageProblem = shallowRef('')
  let snapshot: TabSessionSnapshot | null = null
  let binding: Ref<string | null> | null = null
  let storageScope: ReturnType<typeof effectScope> | null = null
  let restorer: ReturnType<typeof createTabSessionRestorer> | null = null
  let ready = false
  let suspended = 0
  let generation = 0
  const pending = new Set<string>()

  function quietly(action: () => void) {
    suspended += 1
    try {
      action()
    }
    finally {
      suspended -= 1
    }
  }

  function persist() {
    if (!ready || suspended || !snapshot || !binding)
      return
    const previous = snapshot
    snapshot = captureTabSession({ tabs: tabs.tabs, activeKey: tabs.activeKey }, previous, previous.scope, Date.now(), inspectRestorableTabPath)
    const retained = new Set(snapshot.tabs.map(tab => tab.key))
    problems.value = problems.value.filter(problem => retained.has(problem.key))
    for (const key of pending) {
      if (!retained.has(key))
        pending.delete(key)
    }
    binding.value = JSON.stringify(snapshot)
  }

  watch([() => tabs.tabs, () => tabs.activeKey], persist, { flush: 'sync' })

  function cancel() {
    generation += 1
    restorer?.cancel()
    loadingKey.value = null
  }

  function dispose() {
    cancel()
    ready = false
    storageScope?.stop()
    storageScope = null
    binding = null
    snapshot = null
    restorer = null
    pending.clear()
    problems.value = []
  }

  function initialize(options: InitializeOptions) {
    dispose()
    storageProblem.value = ''
    storageScope = effectScope(true)
    binding = storageScope.run(() => useStorage<string | null>(tabSessionStorageKey(options.scope), null, options.storage, {
      writeDefaults: false,
      listenToStorageChanges: false,
      flush: 'sync',
      serializer: { read: value => value, write: value => value ?? '' },
      onError: () => { storageProblem.value = '浏览器无法保存页签位置，本次关闭后可能无法恢复。' },
    }))!
    const result = readTabSession(binding.value, options.scope, inspectRestorableTabPath)
    snapshot = result.snapshot
    diagnostics.value = result.diagnostics
    quietly(() => tabs.restoreSession(snapshot!.tabs.map(tab => ({ ...tab, title: routeTitle(tab.key) || '待恢复页面' }))))
    for (const tab of snapshot.tabs)
      pending.add(tab.key)
    restorer = createTabSessionRestorer({
      descriptors: () => snapshot?.tabs ?? [],
      validate: options.validate,
      onResolved: (descriptor, current) => {
        if (!snapshot)
          return
        const canonicalKey = deriveKey(current.fullPath)
        snapshot = {
          ...snapshot,
          activeKey: snapshot.activeKey === descriptor.key ? canonicalKey : snapshot.activeKey,
          tabs: snapshot.tabs
            .filter(tab => tab.key !== canonicalKey || tab.key === descriptor.key)
            .map(tab => tab.key === descriptor.key
              ? { ...tab, key: canonicalKey, fullPath: current.fullPath, title: current.title, sourceVersion: current.sourceVersion, targetVersion: TAB_TARGET_VERSION }
              : tab),
        }
        pending.delete(descriptor.key)
        pending.delete(canonicalKey)
        problems.value = problems.value.filter(problem => problem.key !== descriptor.key && problem.key !== canonicalKey)
        quietly(() => tabs.updateRestoredTab(descriptor.key, current))
        persist()
      },
      onProblem: (descriptor, problem) => {
        problems.value = [
          ...problems.value.filter(item => item.key !== descriptor.key),
          { ...problem, key: descriptor.key, fullPath: descriptor.fullPath, title: routeTitle(descriptor.key) || '原页面' },
        ]
      },
    })
  }

  async function resolve(key: string): Promise<string | null> {
    const token = ++generation
    loadingKey.value = key
    try {
      const current = await restorer?.resolve(key)
      return token === generation ? current?.fullPath ?? null : null
    }
    finally {
      if (token === generation)
        loadingKey.value = null
    }
  }

  async function restorePath(fullPath: string): Promise<string | null> {
    cancel()
    const key = deriveKey(fullPath)
    if (!snapshot || !pending.has(key))
      return fullPath
    const current = inspectRestorableTabPath(fullPath)
    const previous = snapshot.tabs.find(tab => tab.key === key)
    if (!current || !previous)
      return fullPath
    // 同路径的新来源/筛选是当前导航意图，不能套用存储中的旧来源。
    if (current.fullPath !== previous.fullPath) {
      snapshot = {
        ...snapshot,
        tabs: snapshot.tabs.map(tab => tab.key === key
          ? { ...tab, ...current, sourceVersion: null, targetVersion: TAB_TARGET_VERSION }
          : tab),
      }
    }
    return resolve(key)
  }

  function navigationSucceeded(fullPath: string) {
    const key = deriveKey(fullPath)
    if (!snapshot || !pending.delete(key))
      return
    // 新业务入口已经完成导航；旧恢复事实不能继续占有这个页面身份。
    // 路由成功不代表业务读取已获授权，也不提供当前数据版本。
    const current = inspectRestorableTabPath(fullPath)
    snapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map(tab => tab.key === key
        ? { ...tab, ...current, sourceVersion: null, targetVersion: TAB_TARGET_VERSION }
        : tab),
    }
    problems.value = problems.value.filter(problem => problem.key !== key)
    persist()
  }

  async function startupPath(fullPath: string, browserReload: boolean): Promise<string | null> {
    if (!snapshot)
      return fullPath
    // 原键/字段由空鼓页面在当前身份下重读；这里只保留用户正在刷新的精确工作地址。
    if (browserReload && isQuantityHollowWorkPath(fullPath))
      return fullPath
    if (browserReload) {
      if (readConstructionScopeStartupDescriptors(fullPath, snapshot.scope, globalThis.sessionStorage).length)
        return fullPath
      if (readBoqRecoveryForRoute(fullPath, snapshot.scope, globalThis.sessionStorage).length)
        return fullPath
      if (readBoqSourceImportRecoveryForRoute(fullPath, snapshot.scope, globalThis.sessionStorage).length)
        return fullPath
      if (readPayrollStartupDescriptors(fullPath, snapshot.scope, globalThis.sessionStorage).length)
        return fullPath
      if (readQuantityRecoveryForRoute(fullPath, snapshot.scope, globalThis.sessionStorage).length)
        return fullPath
      for (const target of commandRecoveryRouteTargets(fullPath)) {
        const descriptor = commandRecoveryStorageForFamily(target.family).read(commandRecoveryKey({ ...snapshot.scope, ...target }))
        const permitted = descriptor && (['material-quotation-import', 'other-settlement-import'].includes(descriptor.family)
          ? descriptor.action === 'import'
          : ['crew-worker-import', 'finance-import', 'payroll-import'].includes(descriptor.family)
              ? descriptor.action === 'adopt'
              : ['target-cost-import', 'schedule-import', 'construction-contract-import', 'subcontract-contract-import', 'auxiliary-contract-import', 'owner-document-import'].includes(descriptor.family)
                  ? ['adopt', 'restore'].includes(descriptor.action)
                  : descriptor.family === 'schedule'
                    ? scheduleRecoveryActions.has(descriptor.action)
                    : descriptor.family === 'target-cost'
                      ? ['save-header', 'save-items', 'delete', 'restore'].includes(descriptor.action)
                      : ['draft', 'save', 'submit'].includes(descriptor.action)
                        || (descriptor.family === 'other-settlement' && descriptor.targetId !== null && descriptor.action === 'confirm')
                        || (descriptor.family === 'finance-payment-record' && ['confirm', 'unconfirm'].includes(descriptor.action))
                        || (descriptor.family === 'owner-commercial-document' && descriptor.targetId !== null && descriptor.action === 'delete'))
        if (permitted) {
          return fullPath
        }
      }
    }
    if (fullPath === '/' || (browserReload && !inspectRestorableTabPath(fullPath)))
      return resolve(snapshot.activeKey)
    return browserReload ? restorePath(fullPath) : fullPath
  }

  function finishStartup(fullPath: string) {
    quietly(() => {
      const incomingKey = deriveKey(fullPath)
      // 只有实际保留的直接深链需要新位置；写态刷新回退不会提前删掉旧页签。
      if (snapshot && incomingKey !== HOME_KEY && !tabs.tabs.some(tab => tab.key === incomingKey) && tabs.tabs.filter(tab => tab.closable).length >= MAX_TABS) {
        const oldest = [...snapshot.tabs].sort((a, b) => a.updatedAt - b.updatedAt)[0]
        if (oldest) {
          tabs.close(oldest.key)
          diagnostics.value = [...diagnostics.value, { reason: 'limit', count: 1 }]
        }
      }
      tabs.open({ fullPath, title: routeTitle(fullPath.split('?')[0]!) || '未命名' })
    })
    ready = true
    navigationSucceeded(fullPath)
    persist()
  }

  function dismissDiagnostics() {
    diagnostics.value = []
  }

  function unavailable() {
    storageProblem.value = '暂时无法读取当前会话，页签恢复未启用。可继续使用页面。'
  }

  function dismissStorageProblem() {
    storageProblem.value = ''
  }

  onScopeDispose(dispose)
  return { problems, diagnostics, loadingKey, storageProblem, initialize, startupPath, finishStartup, restorePath, navigationSucceeded, cancel, dispose, dismissDiagnostics, unavailable, dismissStorageProblem }
})
