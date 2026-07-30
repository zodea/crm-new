import { fireEvent, screen } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import KitTypeSelectDialog from '~/components/shared/KitTypeSelectDialog.vue'
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'

const globalComponents = {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
}

const options = [
  { value: 'contract', label: '有合同付款', hint: '关联合同与结算' },
  { value: 'advance', label: '预付款申请' },
  { value: 'company', label: '公司付款' },
]

function mountTypeSelect(overrides: Record<string, unknown> = {}) {
  return mount(KitTypeSelectDialog, {
    attachTo: document.body,
    props: {
      open: true,
      options: {
        title: '新建付款申请',
        options,
        ...overrides,
      },
    },
    global: {
      components: globalComponents,
    },
  })
}

describe('kitTypeSelectDialog public contract', () => {
  it('以 defaultValue 选中 radio，并在确定时返回对应 value', async () => {
    const wrapper = mountTypeSelect({ defaultValue: 'advance' })
    const dialog = await screen.findByRole('dialog', { name: '新建付款申请' })

    expect(screen.getByRole('group', { name: '业务类型' })).not.toBeNull()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect((screen.getByRole('radio', { name: '预付款申请' }) as HTMLInputElement).checked).toBe(true)
    expect((await axe(dialog)).violations).toEqual([])

    await fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(wrapper.emitted('select')).toEqual([['advance']])
    expect(wrapper.emitted('cancel')).toBeUndefined()
    wrapper.unmount()
  })

  it('defaultValue 缺失或无效时回退到第一项', async () => {
    const wrapper = mountTypeSelect({ defaultValue: 'missing' })

    await vi.waitFor(() => {
      expect((screen.getByRole('radio', { name: /有合同付款/ }) as HTMLInputElement).checked).toBe(true)
    })
    wrapper.unmount()
  })

  it('空选项时禁用确定并把焦点安全落到取消按钮', async () => {
    const wrapper = mountTypeSelect({ options: [] })
    const dialog = await screen.findByRole('dialog', { name: '新建付款申请' })
    const cancel = screen.getByRole('button', { name: '取消' })

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cancel)
    })
    expect((screen.getByRole('button', { name: '确定' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect((await axe(dialog)).violations).toEqual([])
    wrapper.unmount()
  })

  it('支持方向键循环移动，并用 Enter 确定', async () => {
    const wrapper = mountTypeSelect()
    const first = await screen.findByRole('radio', { name: /有合同付款/ })

    await fireEvent.keyDown(first, { key: 'ArrowDown' })
    const second = screen.getByRole('radio', { name: '预付款申请' }) as HTMLInputElement
    expect(second.checked).toBe(true)
    expect(document.activeElement).toBe(second)

    await fireEvent.keyDown(second, { key: 'Enter' })
    expect(wrapper.emitted('select')).toEqual([['advance']])
    wrapper.unmount()
  })

  it('双击选项会选中并立即确定', async () => {
    const wrapper = mountTypeSelect()

    await fireEvent.dblClick(await screen.findByText('公司付款'))
    expect(wrapper.emitted('select')).toEqual([['company']])
    wrapper.unmount()
  })

  it('footer 取消走 null 对应的 cancel 事件', async () => {
    const wrapper = mountTypeSelect()

    await fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
    wrapper.unmount()
  })

  it('escape 与遮罩关闭请求都走安全取消路径', async () => {
    const escapeWrapper = mountTypeSelect()
    await screen.findByRole('dialog', { name: '新建付款申请' })
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(escapeWrapper.emitted('cancel')).toHaveLength(1)
    escapeWrapper.unmount()

    const overlayWrapper = mountTypeSelect()
    await screen.findByRole('dialog', { name: '新建付款申请' })
    overlayWrapper.getComponent(Dialog).vm.$emit('update:open', false)

    expect(overlayWrapper.emitted('cancel')).toHaveLength(1)
    overlayWrapper.unmount()
  })
})
