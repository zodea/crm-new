// @vitest-environment jsdom
import type { TabDescriptor, TabRestoreValidator } from '~/lib/tabs/restoration-contract'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
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
  sessionStorage.clear()
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

  it.each([
    ['/contract/construction/form', 'construction-contract', null],
    ['/contract/material/form/contract-a?origin=real', 'material-contract', 'contract-a'],
    ['/contract/subcontract/form/contract-b?origin=real', 'subcontract-contract', 'contract-b'],
    ['/finance/receipt/new?origin=real', 'receipt', null],
    ['/finance/receipt/form/receipt-a?origin=real', 'receipt', 'receipt-a'],
  ] as const)('有效原编号刷新保留精确目标但不持久写态页签或正文：%s', async (path, family, targetId) => {
    seed([descriptor('/project')])
    const pending = { ...scope, family, targetId, action: 'save', commandId: 'pending-original' }
    createCommandRecoveryStorage().remember(commandRecoveryKey(pending), pending)
    const { session, tabs } = initialize(success)
    expect(await session.startupPath(path, true)).toBe(path)
    session.finishStartup(path)
    expect(tabs.activeKey).toBe(path.split('?')[0])
    expect(stored().tabs.map(tab => tab.key)).toEqual(['/project'])
    expect(await session.startupPath(path.replace('origin=real', 'origin=demo'), true)).toBe(path.includes('origin=real') ? '/project' : path)
    sessionStorage.clear()
    expect(await session.startupPath(path, true)).toBe('/project')
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

  it.each([
    ['material-quotation-import', '/material/quotations/import?origin=real'],
    ['other-settlement-import', '/contract/other-settlement/import?origin=real'],
  ])('%s 刷新仅保留同身份原迁入编号，不保存正文或授予普通写态恢复', async (family, path) => {
    seed([descriptor('/project')])
    const pending = { ...scope, family, targetId: null, action: 'import', commandId: 'original-domain-import' }
    const recovery = createCommandRecoveryStorage()
    const key = commandRecoveryKey(pending)
    recovery.remember(key, pending)
    const { session } = initialize(success)
    expect(await session.startupPath(path, true)).toBe(path)
    session.finishStartup(path)
    expect(stored().tabs.map(tab => tab.key)).toEqual(['/project'])
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(pending)
    expect(await session.startupPath(path.replace('origin=real', 'origin=demo'), true)).toBe('/project')
    expect(await session.startupPath(`${path}&origin=real`, true)).toBe('/project')
    recovery.clear(key, pending.commandId)
    recovery.remember(key, { ...pending, action: 'delete' })
    expect(await session.startupPath(path, true)).toBe('/project')
    recovery.clear(key, pending.commandId)
    recovery.remember(key, { ...pending, action: 'submit' })
    expect(await session.startupPath(path, true)).toBe('/project')
    sessionStorage.clear()
    recovery.remember(commandRecoveryKey({ ...pending, actorId: 'other-actor' }), { ...pending, actorId: 'other-actor' })
    expect(await session.startupPath(path, true)).toBe('/project')
  })

  it.each(['crew-worker-import', 'finance-import'])('维护页刷新只消费当前身份 %s 的原采用编号；两域相互独立且不保存文件正文', async (family) => {
    seed([descriptor('/project')])
    const path = '/settings/data-migration?origin=real'
    const pending = { ...scope, family, targetId: null, action: 'adopt', commandId: `original-${family}` }
    const commandStorage = family === 'crew-worker-import' ? localStorage : sessionStorage
    const recovery = createCommandRecoveryStorage(() => commandStorage)
    const key = commandRecoveryKey(pending)
    recovery.remember(key, pending)
    const { session } = initialize(success)
    expect(await session.startupPath(path, true)).toBe(path)
    session.finishStartup(path)
    expect(stored().tabs.map(tab => tab.key)).toEqual(['/project'])
    expect(JSON.parse(commandStorage.getItem(key)!)).toEqual(pending)
    expect((family === 'crew-worker-import' ? sessionStorage : localStorage).getItem(key)).toBeNull()
    for (const invalid of ['/settings/data-migration?origin=demo', '/settings/data-migration?origin=real&origin=real', '/settings/data-migration/unknown'])
      expect(await session.startupPath(invalid, true)).toBe('/project')
    recovery.clear(key, pending.commandId)
    recovery.remember(key, { ...pending, action: 'submit' })
    expect(await session.startupPath(path, true)).toBe('/project')
    recovery.clear(key, pending.commandId)
    recovery.remember(commandRecoveryKey({ ...pending, actorId: 'other-actor' }), { ...pending, actorId: 'other-actor' })
    expect(await session.startupPath(path, true)).toBe('/project')
    recovery.clear(commandRecoveryKey({ ...pending, actorId: 'other-actor' }), pending.commandId)
    recovery.remember(commandRecoveryKey({ ...pending, family: 'other-domain' }), { ...pending, family: 'other-domain' })
    expect(await session.startupPath(path, true)).toBe('/project')
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
