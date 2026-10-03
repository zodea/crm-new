import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCustomerListReturnContext } from '~/composables/useCustomerListReturnContext'
import { useCustomerRelationReturnContext } from '~/composables/useCustomerRelationReturnContext'
import { createCustomerReturnOrigin, customerRelationReturnTo, saveCustomerReturnOrigin } from '~/lib/customer/return-context'

const now = new Date('2026-09-24T08:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
})

describe('客户列表等待当前读取后恢复来源焦点', () => {
  it.each([{ label: '来源行仍存在', exists: true }, { label: '当前结果已移除来源行', exists: false }])('$label', async ({ exists }) => {
    const contextId = 'origin_customer_wait_424'
    const anchorId = 'customer-row-real%3Acustomer-current'
    const origin = createCustomerReturnOrigin({ contextId, anchorId, scrollTop: 120, now, state: { search: '受控客户', status: ['active'], sort: 'name-asc', page: 2, pageSize: 10 } })
    saveCustomerReturnOrigin(origin)
    vi.stubGlobal('useRoute', () => ({ path: '/base/customer', fullPath: origin.returnTo, query: { nav: contextId } }))
    vi.stubGlobal('nextTick', () => Promise.resolve())
    vi.stubGlobal('onActivated', vi.fn())
    document.body.innerHTML = `<main data-shell-workspace><a id="${anchorId}" href="#">非当前列表的旧来源</a><section data-current-list><h1 tabindex="-1">客户列表</h1></section></main>`
    const root = document.querySelector<HTMLElement>('[data-current-list]')!
    const heading = root.querySelector<HTMLElement>('h1')!
    let ready = false
    const context = useCustomerListReturnContext({
      readState: () => ({ search: '', status: [], sort: 'updated-desc', page: 1, pageSize: 10 }),
      applyState: vi.fn(),
      root: () => root,
      isReady: () => ready,
      fallbackFocus: () => heading,
    })
    expect(await context.restore()).toBe(false)
    expect(document.activeElement).toBe(document.body)
    if (exists)
      root.insertAdjacentHTML('beforeend', `<div id="${anchorId}"><a href="#">当前来源客户</a></div>`)
    ready = true
    expect(await context.restore()).toBe(true)
    expect(document.activeElement).toBe(exists ? root.querySelector('a') : heading)
    expect(document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop).toBe(120)
  })
})

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('客户项目返回的稳定来源行', () => {
  it.each([
    { exists: true, expiresAt: now + 60_000, restored: true },
    { exists: false, expiresAt: now + 60_000, restored: true },
    { exists: true, expiresAt: now - 1, restored: false },
  ])('原来源行存在=$exists，有效期=$expiresAt 时恢复结果=$restored', async ({ exists, expiresAt, restored }) => {
    const returnTo = customerRelationReturnTo('/base/customer/customer-a?origin=real&tab=contracts', 'origin_repeat_424')!
    sessionStorage.setItem('ruihang:customer-relation-return:origin_repeat_424', JSON.stringify({
      returnTo,
      targetEntity: 'project',
      targetId: 'project-a',
      anchorId: 'contract:contract-b',
      scrollTop: 80,
      scrollLeft: 0,
      expiresAt,
    }))
    vi.stubGlobal('useRoute', () => ({ path: '/base/customer/customer-a', fullPath: returnTo }))
    document.body.innerHTML = `<main data-shell-workspace><section tabindex="-1" data-customer-relations>
      <a href="#" data-customer-target-id="project-a" data-customer-target-entity="project" data-customer-relation-anchor="contract:contract-a">同项目第一行</a>
      ${exists ? '<a href="#" data-customer-target-id="project-a" data-customer-target-entity="project" data-customer-relation-anchor="contract:contract-b">同项目第二行</a>' : ''}
    </section></main>`
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const restore = useCustomerRelationReturnContext({ customerId: () => 'customer-a', origin: () => 'real' })
    expect(await restore()).toBe(restored)
    expect(document.activeElement).toBe(restored
      ? document.querySelector(exists ? '[data-customer-relation-anchor="contract:contract-b"]' : '[data-customer-relations]')
      : document.body)
    expect(document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop).toBe(restored ? 80 : 0)
  })
})
