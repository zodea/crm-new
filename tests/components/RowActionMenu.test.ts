import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import RowActionMenu from '~/components/ui/RowActionMenu.vue'

describe('row action menu', () => {
  it('用一个稳定入口承载详情、编辑和危险操作', async () => {
    const view = render(RowActionMenu, {
      props: {
        label: '合同操作',
        items: [
          { key: 'detail', label: '查看详情', icon: 'i-lucide-file-text' },
          { key: 'edit', label: '编辑', icon: 'i-lucide-square-pen' },
          { key: 'delete', label: '删除', icon: 'i-lucide-trash-2', tone: 'danger' },
        ],
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: '合同操作' }))
    expect(screen.getByRole('menu', { name: '合同操作' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))

    expect(view.emitted().select).toEqual([['edit']])
    expect(screen.getByRole('menu', { name: '合同操作' }).getAttribute('data-state')).toBe('closed')
  })

  it('支持键盘打开、导航、Escape 关闭并把焦点归还触发器', async () => {
    render(RowActionMenu, {
      props: {
        label: '合同操作',
        items: [
          { key: 'detail', label: '查看详情' },
          { key: 'edit', label: '编辑' },
          { key: 'delete', label: '删除', tone: 'danger' },
        ],
      },
    })

    const trigger = screen.getByRole('button', { name: '合同操作' })
    trigger.focus()
    await fireEvent.keyDown(trigger, { key: 'Enter' })
    const menu = await screen.findByRole('menu', { name: '合同操作' })
    expect(menu.getAttribute('data-state')).toBe('open')

    await fireEvent.keyDown(menu, { key: 'ArrowDown' })
    await fireEvent.keyDown(menu, { key: 'Escape' })

    expect(menu.getAttribute('data-state')).toBe('closed')
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('空动作保留明确说明，禁用动作不会发出选择', async () => {
    const view = render(RowActionMenu, { props: { label: '预算版本操作', items: [] } })
    await fireEvent.click(screen.getByRole('button', { name: '预算版本操作' }))
    expect(screen.getByText('无可用操作')).not.toBeNull()
    expect(screen.queryByRole('menuitem')).toBeNull()
    await view.rerender({ items: [{ key: 'edit', label: '编辑冻结历史', disabled: true }] })
    const action = screen.getByRole('menuitem', { name: '编辑冻结历史' })
    expect(action.getAttribute('data-disabled')).not.toBeNull()
    await fireEvent.click(action)
    expect(view.emitted().select).toBeUndefined()
  })
})
