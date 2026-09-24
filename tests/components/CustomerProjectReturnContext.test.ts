import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCustomerRelationReturnContext } from '~/composables/useCustomerRelationReturnContext'
import { customerRelationReturnTo } from '~/lib/customer/return-context'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('客户项目返回的稳定来源行', () => {
  it.each([true, false])('原来源行存在=%s 时恢复该行或关系区，不误聚焦同项目其他行', async (exists) => {
    const returnTo = customerRelationReturnTo('/base/customer/customer-a?origin=real&tab=contracts', 'origin_repeat_424')!
    sessionStorage.setItem('ruihang:customer-relation-return:origin_repeat_424', JSON.stringify({
      returnTo,
      targetEntity: 'project',
      targetId: 'project-a',
      anchorId: 'contract:contract-b',
      scrollTop: 80,
      scrollLeft: 0,
      expiresAt: Date.now() + 60_000,
    }))
    vi.stubGlobal('useRoute', () => ({ path: '/base/customer/customer-a', fullPath: returnTo }))
    document.body.innerHTML = `<main data-shell-workspace><section tabindex="-1" data-customer-relations>
      <a href="#" data-customer-target-id="project-a" data-customer-target-entity="project" data-customer-relation-anchor="contract:contract-a">同项目第一行</a>
      ${exists ? '<a href="#" data-customer-target-id="project-a" data-customer-target-entity="project" data-customer-relation-anchor="contract:contract-b">同项目第二行</a>' : ''}
    </section></main>`
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const restore = useCustomerRelationReturnContext({ customerId: () => 'customer-a', origin: () => 'real' })
    expect(await restore()).toBe(true)
    expect(document.activeElement).toBe(document.querySelector(exists ? '[data-customer-relation-anchor="contract:contract-b"]' : '[data-customer-relations]'))
  })
})
