import type { NavigationIntentDTO } from '~/types/read-model'
import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import EntityLink from '~/components/ui/EntityLink.vue'

const unavailable: NavigationIntentDTO = {
  kind: 'unavailable',
  reason: 'unverified-target',
}

vi.stubGlobal('useProjectStore', () => ({ byId: vi.fn() }))
vi.stubGlobal('useSupplierStore', () => ({ byId: vi.fn() }))
vi.stubGlobal('useContractStore', () => ({ byId: vi.fn() }))

describe('entity link Target Registry 展示', () => {
  it('未核验目标显示稳定原因，不伪装为链接', () => {
    render(EntityLink, {
      props: {
        type: 'project',
        label: '待核验项目',
        intent: unavailable,
      },
      global: {
        components: {
          NuxtLink: defineComponent({
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          }),
        },
      },
    })

    expect(screen.queryByRole('link')).toBeNull()
    const target = screen.getByText(/待核验项目/)
    expect(target.getAttribute('data-target-state')).toBe('unverified-target')
    expect(target.textContent).toContain('目标待核验')
  })

  it('forbidden unavailable 不显示调用方提供的敏感 label', () => {
    render(EntityLink, {
      props: {
        type: 'project',
        label: '不能泄露的项目名',
        intent: { kind: 'unavailable', reason: 'forbidden' },
      },
      global: {
        components: {
          NuxtLink: defineComponent({
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          }),
        },
      },
    })

    expect(screen.queryByText(/不能泄露的项目名/)).toBeNull()
    expect(screen.getByText('无查看权限').getAttribute('data-target-state')).toBe('forbidden')
  })
})
