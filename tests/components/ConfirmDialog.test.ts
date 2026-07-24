import { fireEvent, screen } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { nextTick } from 'vue'
import ConfirmDialog from '~/components/shared/ConfirmDialog.vue'
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

function mountConfirm(overrides: Record<string, unknown> = {}) {
  return mount(ConfirmDialog, {
    attachTo: document.body,
    props: {
      open: true,
      message: '删除后不可恢复。',
      ...overrides,
    },
    global: {
      components: globalComponents,
    },
  })
}

describe('confirmDialog public contract', () => {
  it('opens accessibly, defaults focus to cancel, and confirms explicitly', async () => {
    const wrapper = mountConfirm({ title: '删除项目' })

    await vi.waitFor(() => {
      expect(screen.getByRole('dialog')).not.toBeNull()
    })

    const cancel = screen.getByRole('button', { name: '取消' })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(cancel)
    })

    const dialog = screen.getByRole('dialog')
    expect(screen.getByRole('heading', { name: '删除项目' })).not.toBeNull()
    expect((await axe(dialog)).violations).toEqual([])

    await fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('treats Escape as the safe cancel path', async () => {
    const wrapper = mountConfirm()

    await vi.waitFor(() => {
      expect(screen.getByRole('dialog')).not.toBeNull()
    })
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps cascade confirmation disabled until the exact entity name is typed', async () => {
    const wrapper = mountConfirm({
      variant: 'cascade',
      requireTyping: '滨江壹号',
      impact: [{ label: '合同', n: 3 }],
    })

    const confirm = await screen.findByRole('button', { name: '确定' }) as HTMLButtonElement
    const input = screen.getByRole('textbox', { name: /请输入/ })
    expect(confirm.disabled).toBe(true)
    expect(screen.getByText('×3')).not.toBeNull()

    await fireEvent.update(input, '滨江壹')
    expect(confirm.disabled).toBe(true)

    await fireEvent.update(input, '滨江壹号')
    expect(confirm.disabled).toBe(false)

    await fireEvent.click(confirm)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(screen.getByRole('button', { name: /撤销/ })).not.toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: /撤销/ }))
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('renders the batch impact count as user-visible content', async () => {
    const wrapper = mountConfirm({ variant: 'batch', count: 12 })

    await vi.waitFor(() => {
      expect(screen.getByText(/将删除/).textContent).toContain('12')
    })
    wrapper.unmount()
  })
})
