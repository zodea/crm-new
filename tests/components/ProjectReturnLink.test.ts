import { render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ProjectReturnLink from '~/components/project/ProjectReturnLink.vue'

const NuxtLinkStub = defineComponent({
  props: { to: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('a', { href: props.to }, slots.default?.())
  },
})

describe('project return link expiry', () => {
  afterEach(() => vi.useRealTimers())

  it('详情停留到来源上下文过期时主动降级到规范项目列表', async () => {
    const now = Date.UTC(2026, 7, 21, 12, 0, 0)
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const returnTo = '/project?nav=origin_313#project-row-real%3Aproject-1'
    const view = render(ProjectReturnLink, {
      props: { to: returnTo, expiresAt: now + 1_000 },
      global: { components: { NuxtLink: NuxtLinkStub } },
    })

    const link = screen.getByRole('link', { name: '返回项目列表' })
    expect(link.getAttribute('href')).toBe(returnTo)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(link.getAttribute('href')).toBe('/project')
    view.unmount()
  })
})
