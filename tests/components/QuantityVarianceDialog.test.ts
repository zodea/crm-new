import type { QuantityVarianceFact } from '~/lib/quantity/variance'
import { render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import QuantityVarianceDialog from '~/components/quantity/QuantityVarianceDialog.vue'

const loadQuantityVarianceFacts = vi.hoisted(() => vi.fn())

vi.mock('~/lib/quantity/variance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/quantity/variance')>()
  return {
    ...actual,
    loadQuantityVarianceFacts,
  }
})

const SelectFilterStub = defineComponent({
  props: {
    modelValue: String,
    label: String,
    options: { type: Array, default: () => [] },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('label', [
      props.label,
      h('select', {
        value: props.modelValue,
        onChange: (event: Event) =>
          emit('update:modelValue', (event.target as HTMLSelectElement).value),
      }, (props.options as { key: string, label: string }[]).map(option =>
        h('option', { value: option.key }, option.label),
      )),
    ])
  },
})

const KitTableStub = defineComponent({
  props: {
    data: { type: Array, default: () => [] },
    loading: Boolean,
  },
  setup(props) {
    return () => h('div', {
      'data-testid': 'variance-table',
      'aria-busy': props.loading ? 'true' : undefined,
    }, (props.data as { itemName: string }[]).map(row => row.itemName))
  },
})

const factA: QuantityVarianceFact = {
  id: 'fact-a',
  buildingId: 'building-a',
  buildingName: 'A 栋',
  buildingSortOrder: 1,
  itemId: 'item-a',
  itemName: '项目 A 墙砖',
  itemSortOrder: 1,
  section: '装饰装修',
  trade: '泥水工',
  unit: '㎡',
  contractQty: 10,
  provisionalQty: 12,
  fieldQty: 11,
  effectiveUnitPrice: 100,
  updatedAt: '2026-07-30T00:00:00.000Z',
}

describe('quantity variance dialog', () => {
  it('clears prior-project facts before a failed reload and keeps mobile content vertically reachable', async () => {
    loadQuantityVarianceFacts
      .mockResolvedValueOnce([factA])
      .mockRejectedValueOnce(new Error('项目 B 读取失败'))

    const view = render(QuantityVarianceDialog, {
      props: {
        open: false,
        projectId: 'project-a',
        initialBuildingId: 'building-a',
      },
      global: {
        components: {
          KitTable: KitTableStub,
          SelectFilter: SelectFilterStub,
        },
      },
    })

    await view.rerender({
      open: true,
      projectId: 'project-a',
      initialBuildingId: 'building-a',
    })
    await flushPromises()
    expect(screen.getByTestId('variance-table').textContent).toContain('项目 A 墙砖')

    await view.rerender({
      open: false,
      projectId: 'project-a',
      initialBuildingId: 'building-a',
    })
    await view.rerender({
      open: true,
      projectId: 'project-b',
      initialBuildingId: 'building-b',
    })
    await flushPromises()

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('项目 B 读取失败'),
    )
    expect(screen.getByTestId('variance-table').textContent).not.toContain('项目 A 墙砖')

    const mobileScroll = document.querySelector<HTMLElement>('[data-ui="quantity-variance-scroll"]')
    const tableRegion = document.querySelector<HTMLElement>('[data-ui="quantity-variance-table"]')
    expect(mobileScroll?.classList.contains('overflow-y-auto')).toBe(true)
    expect(tableRegion?.classList.contains('h-80')).toBe(true)
    expect(tableRegion?.classList.contains('md:flex-1')).toBe(true)
  })
})
