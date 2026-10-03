import type { QuantityVarianceFact } from '~/lib/quantity/variance'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import QuantityVarianceDialog from '~/components/quantity/QuantityVarianceDialog.vue'

const loadQuantityVarianceFacts = vi.hoisted(() => vi.fn())
beforeEach(() => vi.stubGlobal('useQuantityStore', () => ({ loadVariance: loadQuantityVarianceFacts })))

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
  it('分部与工种各自多选取并集、跨字段取交集，候选不因筛选缩水且清空恢复', async () => {
    loadQuantityVarianceFacts.mockResolvedValueOnce([
      factA,
      { ...factA, id: 'b', itemId: 'b', itemName: '电气布线', section: '机电安装', trade: '电工' },
      { ...factA, id: 'c', itemId: 'c', itemName: '装饰接线', section: '装饰装修', trade: '电工' },
    ])
    const view = render(QuantityVarianceDialog, {
      props: { open: false, projectId: 'project-a' },
      global: { components: { KitTable: KitTableStub, SelectFilter: SelectFilterStub } },
    })
    await view.rerender({ open: true })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '分部，已选 0 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '装饰装修' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '机电安装' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.getByTestId('variance-table').textContent).toContain('电气布线')
    await fireEvent.click(screen.getByRole('button', { name: '工种，已选 0 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '泥水工' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.getByTestId('variance-table').textContent).toBe('项目 A 墙砖')
    await fireEvent.click(screen.getByRole('button', { name: '分部，已选 2 项' }))
    expect((screen.getByRole('checkbox', { name: '机电安装' }) as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(screen.getByTestId('variance-table').textContent).toBe('项目 A 墙砖')
    await fireEvent.click(screen.getByRole('button', { name: '工种，已选 1 项' }))
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(screen.getByTestId('variance-table').textContent).toContain('电气布线')
    expect((screen.getByRole('combobox', { name: '对比口径' }) as HTMLSelectElement).value).toBe('field')
  })

  it('clears prior-project facts before a failed reload', async () => {
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
  })
})
