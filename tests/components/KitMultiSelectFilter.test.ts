import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'

vi.mock('~/composables/useOverlayStack', () => ({ useOwnedOverlayLayerStyle: () => ({ zIndex: 80 }) }))

describe('列表多选筛选器', () => {
  it('显示数量，全选在应用时发数组，Esc不提交草稿，清除回到不限', async () => {
    const { emitted, rerender } = render(KitMultiSelectFilter, { props: {
      label: '合同状态',
      modelValue: [],
      options: [{ key: 'all', label: '全部' }, { key: 'draft', label: '草稿' }, { key: 'signed', label: '已签订' }],
    } })
    const trigger = screen.getByRole('button', { name: '合同状态，已选 0 项' })
    expect(trigger.classList.contains('is-active')).toBe(false)
    await fireEvent.click(trigger)
    await fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect(screen.getByText('已选 2 项')).toBeTruthy()
    expect(emitted()['update:modelValue']).toBeUndefined()
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(emitted()['update:modelValue']).toEqual([[['draft', 'signed']]])
    await rerender({ modelValue: ['draft', 'signed'] })
    await fireEvent.click(screen.getByRole('button', { name: '合同状态，已选 2 项' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '草稿' }))
    await fireEvent.keyDown(screen.getByRole('checkbox', { name: '草稿' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(emitted()['update:modelValue']).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: '合同状态，已选 2 项' }))
    expect((screen.getByRole('checkbox', { name: '草稿' }) as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(emitted()['update:modelValue']).toEqual([[['draft', 'signed']], [[]]])
  })
})
