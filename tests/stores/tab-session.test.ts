// @vitest-environment jsdom
import type { TabDescriptor, TabRestoreValidator } from '~/lib/tabs/restoration-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tabSessionStorageKey } from '~/lib/tabs/session-persistence'
import { useTabSessionStore } from '~/stores/tab-session'
import { useTabsStore } from '~/stores/tabs'

const scope = { workspaceId: 'tab-workspace', actorId: 'tab-actor' }
const storageKey = tabSessionStorageKey(scope)
function descriptor(fullPath: string, updatedAt = 1): TabDescriptor {
  return {
    key: fullPath.split('?')[0]!,
    fullPath,
    title: '旧记录的敏感名称',
    origin: null,
    targetVersion: 1,
    sourceVersion: null,
    updatedAt,
    closable: true,
  }
}
const success: TabRestoreValidator = async tab => ({ state: 'resolved', title: '当前可读页面', fullPath: tab.fullPath, sourceVersion: 'v2' })

function seed(tabs: TabDescriptor[], activeKey = tabs.at(-1)?.key ?? 'home') {
  localStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, scope, tabs, activeKey }))
}
function stored() {
  return JSON.parse(localStorage.getItem(storageKey)!) as { tabs: TabDescriptor[], activeKey: string }
}
function initialize(validate: TabRestoreValidator = success) {
  const session = useTabSessionStore()
  session.initialize({ scope, storage: localStorage, validate })
  return { session, tabs: useTabsStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('浏览器页签恢复接线', () => {
  it('启动仅验证活动页，首次激活再验证其他详情，旧标题不先泄露', async () => {
    seed([descriptor('/project', 1), descriptor('/base/supplier', 2)])
    const validate = vi.fn(success)
    const { session, tabs } = initialize(validate)
    expect(tabs.tabs.map(tab => tab.title)).not.toContain('旧记录的敏感名称')
    expect(validate).not.toHaveBeenCalled()
    const path = await session.startupPath('/', false)
    expect(path).toBe('/base/supplier')
    session.finishStartup(path!)
    expect(validate.mock.calls.map(([tab]) => tab.key)).toEqual(['/base/supplier'])
    expect(stored().tabs.find(tab => tab.key === '/base/supplier')?.sourceVersion).toBe('v2')
    expect(await session.restorePath('/project')).toBe('/project')
    expect(validate.mock.calls.map(([tab]) => tab.key)).toEqual(['/base/supplier', '/project'])
    expect(await session.restorePath('/base/supplier')).toBe('/base/supplier')
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it('当前详情失效保留可关闭问题态，回退最近合法项，关闭同步移除存储', async () => {
    seed([descriptor('/project', 1), descriptor('/base/supplier', 2)])
    const validate = vi.fn<TabRestoreValidator>(async tab => tab.key === '/base/supplier'
      ? { state: 'forbidden', message: '当前没有查看权限' }
      : success(tab))
    const { session, tabs } = initialize(validate)
    const path = await session.startupPath('/', false)
    session.finishStartup(path!)
    expect(path).toBe('/project')
    expect(session.problems[0]).toMatchObject({ key: '/base/supplier', state: 'forbidden' })
    tabs.close('/base/supplier')
    expect(session.problems).toEqual([])
    expect(stored().tabs.map(tab => tab.key)).toEqual(['/project'])
    tabs.closeEvery()
    expect(stored()).toMatchObject({ tabs: [], activeKey: 'home' })
  })

  it('直接深链优先，浏览器刷新写态才回退；软刷新不改集合或最近时间', async () => {
    seed([descriptor('/project', 12)])
    const { session, tabs } = initialize(success)
    expect(await session.startupPath('/base/customer', false)).toBe('/base/customer')
    session.finishStartup('/base/customer')
    tabs.open({ fullPath: '/project/new', title: '未保存项目' })
    expect(stored().tabs.some(tab => tab.fullPath.includes('/new'))).toBe(false)
    expect(await session.startupPath('/project/new', true)).toBe('/base/customer')
    tabs.open({ fullPath: '/project', title: '项目' })
    const before = stored()
    tabs.refreshActive()
    expect(stored()).toEqual(before)
  })

  it('关闭和新导航使迟到恢复失效，不能改写路由或恢复已关闭描述符', async () => {
    seed([descriptor('/project')])
    let resolve!: (value: Awaited<ReturnType<TabRestoreValidator>>) => void
    const { session, tabs } = initialize(() => new Promise((done) => {
      resolve = done
    }))
    session.finishStartup('/')
    const request = session.restorePath('/project')
    tabs.close('/project')
    session.cancel()
    resolve({ state: 'resolved', title: '迟到项目', fullPath: '/project', sourceVersion: 'v2' })
    expect(await request).toBeNull()
    expect(tabs.tabs.some(tab => tab.key === '/project')).toBe(false)
    expect(stored().tabs).toEqual([])
  })

  it('损坏值给可关闭迁移提示，当前身份不读取其他用户工作区', () => {
    localStorage.setItem(storageKey, '{broken')
    const { session } = initialize()
    expect(session.diagnostics).toMatchObject([{ reason: 'invalid-storage', count: 1 }])
    session.dismissDiagnostics()
    expect(session.diagnostics).toEqual([])
    seed([descriptor('/project')])
    session.dispose()
    session.initialize({ scope: { ...scope, actorId: 'different' }, storage: localStorage, validate: success })
    expect(useTabsStore().tabs.map(tab => tab.key)).toEqual(['home'])
    expect(localStorage.getItem(storageKey)).toContain('/project')
  })

  it('恢复已满集合时为当前直接深链保留一个位置，仍不超过十五项', () => {
    const paths = ['/project', '/base/customer', '/base/supplier', '/base/crew', '/base/worker', '/schedule', '/contract/construction', '/contract/subcontract', '/contract/material', '/finance/receipt', '/finance/payment', '/finance/ledger', '/material/arrival', '/material/use', '/material/requisition']
    seed(paths.map((path, i) => descriptor(path, i)))
    const { session, tabs } = initialize(success)
    session.finishStartup('/finance/invoice/factor')
    expect(tabs.tabs.filter(tab => tab.closable)).toHaveLength(15)
    expect(tabs.activeKey).toBe('/finance/invoice/factor')
    expect(tabs.tabs.some(tab => tab.key === '/project')).toBe(false)
  })

  it('刷新写态页回退已有只读项时不能提前丢掉第十五个旧页签', async () => {
    const paths = ['/project', '/base/customer', '/base/supplier', '/base/crew', '/base/worker', '/schedule', '/contract/construction', '/contract/subcontract', '/contract/material', '/finance/receipt', '/finance/payment', '/finance/ledger', '/material/arrival', '/material/use', '/material/requisition']
    seed(paths.map((path, i) => descriptor(path, i)), '/project')
    const { session, tabs } = initialize(success)
    const current = await session.startupPath('/finance/invoice', true)
    session.finishStartup(current!)
    expect(tabs.tabs.filter(tab => tab.closable)).toHaveLength(15)
    expect(stored().tabs).toHaveLength(15)
    expect(tabs.activeKey).toBe('/project')
  })

  it('当前身份规范化编码后原子替换旧key，不新增重复页签', async () => {
    const old = { ...descriptor('/project/project:1?origin=real'), origin: 'real' as const }
    seed([old])
    const { session, tabs } = initialize(async () => ({ state: 'resolved', fullPath: '/project/project%3A1?origin=real', title: '当前项目', sourceVersion: 'v2' }))
    session.finishStartup((await session.startupPath('/', false))!)
    expect(tabs.tabs.filter(tab => tab.closable).map(tab => tab.key)).toEqual(['/project/project%3A1'])
    expect(stored().tabs).toMatchObject([{ key: '/project/project%3A1', sourceVersion: 'v2' }])
  })
})
