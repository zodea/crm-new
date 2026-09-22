import type { TabDescriptor, TabRestoreResult } from '~/lib/tabs/restoration-contract'
import { describe, expect, it, vi } from 'vitest'
import { createTabSessionRestorer } from '~/lib/tabs/restore-session'

const descriptor = (id: string, updatedAt: number): TabDescriptor => ({ key: `/project/${id}`, title: id, fullPath: `/project/${id}?origin=real`, origin: 'real', targetVersion: 1, sourceVersion: null, updatedAt, closable: true })
const resolved = (tab: TabDescriptor): TabRestoreResult => ({ state: 'resolved', fullPath: tab.fullPath, title: `当前${tab.title}`, sourceVersion: 'fresh' })

function harness(tabs: TabDescriptor[], validate = vi.fn(async (tab: TabDescriptor) => resolved(tab))) {
  const onResolved = vi.fn()
  const onProblem = vi.fn()
  const restorer = createTabSessionRestorer({ descriptors: () => tabs, validate, onResolved, onProblem })
  return { restorer, validate, onResolved, onProblem }
}

describe('页签恢复按需校验与安全回退', () => {
  it('只读取活动页，其他14个不被启动恢复挂载或查询', async () => {
    const tabs = Array.from({ length: 15 }, (_, index) => descriptor(String(index), index))
    const context = harness(tabs)
    expect(await context.restorer.resolve(tabs[4]!.key)).toEqual({ key: tabs[4]!.key, fullPath: tabs[4]!.fullPath })
    expect(context.validate.mock.calls.map(call => call[0].key)).toEqual([tabs[4]!.key])
    expect(context.onResolved).toHaveBeenCalledWith(tabs[4], resolved(tabs[4]!))
  })

  it('失效活动项后按最近访问串行寻找有效项，并保留可关闭的问题记录', async () => {
    const tabs = [descriptor('a', 1), descriptor('b', 3), descriptor('c', 2)]
    const validate = vi.fn(async (tab: TabDescriptor): Promise<TabRestoreResult> => tab.title === 'a'
      ? { state: 'not-found', message: '目标已删除' }
      : tab.title === 'b' ? { state: 'forbidden', message: '无查看权限' } : resolved(tab))
    const context = harness(tabs, validate)
    expect(await context.restorer.resolve('/project/a')).toEqual({ key: '/project/c', fullPath: '/project/c?origin=real' })
    expect(validate.mock.calls.map(call => call[0].title)).toEqual(['a', 'b', 'c'])
    expect(context.onProblem.mock.calls.map(call => call[1].state)).toEqual(['not-found', 'forbidden'])
    expect(context.onResolved).toHaveBeenCalledOnce()
  })

  it('所有目标不可用时回到首页；主动回首页无需读取其他页', async () => {
    const context = harness([descriptor('a', 1)], vi.fn(async () => ({ state: 'not-connected', message: '来源未接入' } as const)))
    expect(await context.restorer.resolve('/project/a')).toEqual({ key: 'home', fullPath: '/' })
    context.validate.mockClear()
    expect(await context.restorer.resolve('home')).toEqual({ key: 'home', fullPath: '/' })
    expect(context.validate).not.toHaveBeenCalled()
  })

  it('切换到另一页或显式取消后，旧响应不抢回页面也不写入旧标题或错误', async () => {
    let finish!: (result: TabRestoreResult) => void
    const tabs = [descriptor('a', 1), descriptor('b', 2)]
    const validate = vi.fn((tab: TabDescriptor) => tab.title === 'a'
      ? new Promise<TabRestoreResult>(resolve => finish = resolve)
      : Promise.resolve(resolved(tab)))
    const context = harness(tabs, validate)
    const previous = context.restorer.resolve('/project/a')
    const current = await context.restorer.resolve('/project/b')
    finish(resolved(tabs[0]!))
    expect(await previous).toBeNull()
    expect(current?.key).toBe('/project/b')
    expect(context.onResolved.mock.calls.map(call => call[0].key)).toEqual(['/project/b'])
    expect(context.onProblem).not.toHaveBeenCalled()
    const cancelled = context.restorer.resolve('/project/a')
    context.restorer.cancel()
    finish({ state: 'forbidden', message: '迟到错误' })
    expect(await cancelled).toBeNull()
    expect(context.onProblem).not.toHaveBeenCalled()
  })

  it('读取期间目标已关闭或参数被替换时不能复活旧页签', async () => {
    let finish!: (result: TabRestoreResult) => void
    const tabs = [descriptor('a', 1)]
    const context = harness(tabs, vi.fn(() => new Promise<TabRestoreResult>(resolve => finish = resolve)))
    const pending = context.restorer.resolve('/project/a')
    const original = tabs[0]!
    tabs.splice(0)
    finish(resolved(original))
    expect(await pending).toBeNull()
    expect(context.onResolved).not.toHaveBeenCalled()
    tabs.push(original)
    const changed = context.restorer.resolve('/project/a')
    tabs[0] = { ...original, fullPath: '/project/a?origin=demo', origin: 'demo' }
    finish(resolved(original))
    expect(await changed).toBeNull()
    expect(context.onResolved).not.toHaveBeenCalled()
  })

  it('读取异常有稳定恢复提示，AbortError不冒充业务失败', async () => {
    const context = harness([descriptor('a', 1)], vi.fn(async () => {
      throw new Error('内部请求细节')
    }))
    expect(await context.restorer.resolve('/project/a')).toEqual({ key: 'home', fullPath: '/' })
    expect(context.onProblem).toHaveBeenCalledWith(expect.anything(), { state: 'error', message: '页面恢复失败，请重试' })
    const aborted = harness([descriptor('a', 1)], vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError')
    }))
    expect(await aborted.restorer.resolve('/project/a')).toBeNull()
    expect(aborted.onProblem).not.toHaveBeenCalled()
  })
})
