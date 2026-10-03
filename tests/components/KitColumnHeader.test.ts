import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'

vi.mock('~/composables/useOverlayStack', () => ({ useOwnedOverlayLayerStyle: () => ({ zIndex: 80 }) }))

describe('可操作表头', () => {
  it('枚举多选先编辑后应用，不限清空，空数组不显示活动态', async () => {
    const { emitted, rerender } = render(KitColumnHeader, { props: {
      title: '状态',
      kind: 'multi-enum',
      value: [],
      options: [{ key: 'draft', label: '草稿' }, { key: 'submitted', label: '已提交' }],
    } })
    const trigger = screen.getByRole('button', { name: '筛选状态' })
    expect(screen.queryByText('已筛选')).toBeNull()
    await fireEvent.click(trigger)
    await fireEvent.click(screen.getByRole('checkbox', { name: '草稿' }))
    await fireEvent.click(screen.getByRole('checkbox', { name: '已提交' }))
    expect(emitted().apply).toBeUndefined()
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(emitted().apply).toEqual([[['draft', 'submitted']]])
    await rerender({ value: ['draft', 'submitted'] })
    expect(screen.getByText('已筛选')).not.toBeNull()
    await fireEvent.click(trigger)
    expect((screen.getByRole('checkbox', { name: '草稿' }) as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(screen.getByRole('checkbox', { name: '不限' }))
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(emitted().apply).toEqual([[['draft', 'submitted']], [[]]])
    await rerender({ value: [] })
    expect(screen.queryByText('已筛选')).toBeNull()
  })

  it('打开真实文本筛选，应用输入并可重新打开清空', async () => {
    const { emitted } = render(KitColumnHeader, { props: { title: '注册地址', kind: 'text', value: '' } })
    await fireEvent.click(screen.getByRole('button', { name: '筛选注册地址' }))
    await fireEvent.update(screen.getByRole('textbox', { name: '注册地址包含' }), '广州')
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(emitted().apply).toEqual([['广州']])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await fireEvent.click(screen.getByRole('button', { name: '筛选注册地址' }))
    await fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(emitted().apply).toEqual([['广州'], ['']])
  })

  it.each([
    { min: '100', max: '10' },
    { min: '0', max: '-1' },
    { min: '10.01', max: '10' },
  ])('拒绝倒置范围 $min > $max；排序动作独立发出且不吞掉筛选', async ({ min, max }) => {
    const { emitted } = render(KitColumnHeader, { props: {
      title: '有效合同额',
      kind: 'number',
      value: { min: 0 },
      sortOptions: [{ key: 'contractAmount-asc', label: '金额升序' }],
    } })
    await fireEvent.click(screen.getByRole('button', { name: '筛选有效合同额' }))
    await fireEvent.update(screen.getByRole('spinbutton', { name: '最小值' }), min)
    await fireEvent.update(screen.getByRole('spinbutton', { name: '最大值' }), max)
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.getByRole('alert').textContent).toContain('最大值不能小于最小值')
    expect(emitted().apply).toBeUndefined()
    await fireEvent.click(screen.getByRole('button', { name: '金额升序' }))
    expect(emitted().sort).toEqual([['contractAmount-asc']])
  })

  it.each([
    { min: '0', max: '10', expected: { min: 0, max: 10 } },
    { min: '10', max: '10', expected: { min: 10, max: 10 } },
    { min: '', max: '10', expected: { max: 10 } },
    { min: '10', max: '', expected: { min: 10 } },
  ])('有效范围 $min 到 $max 按原始边界提交', async ({ min, max, expected }) => {
    const { emitted } = render(KitColumnHeader, { props: { title: '有效合同额', kind: 'number', value: null } })
    await fireEvent.click(screen.getByRole('button', { name: '筛选有效合同额' }))
    await fireEvent.update(screen.getByRole('spinbutton', { name: '最小值' }), min)
    await fireEvent.update(screen.getByRole('spinbutton', { name: '最大值' }), max)
    await fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(emitted().apply).toEqual([[expected]])
  })
})
