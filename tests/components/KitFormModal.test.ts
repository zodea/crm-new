import type { FormModalOptions } from '~/lib/kit/form-modal'
import { fireEvent, screen } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'
import KitFormModal from '~/components/shared/KitFormModal.vue'
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

const baseOptions: FormModalOptions = {
  title: '新建项目',
  fields: [
    { key: 'name', label: '项目名称', required: true },
    { key: 'status', label: '状态', type: 'select', options: ['进行中', '已完成'] },
    { key: 'remark', label: '备注', type: 'textarea' },
  ],
}

function mountModal(options: FormModalOptions = baseOptions) {
  return mount(KitFormModal, {
    attachTo: document.body,
    props: {
      open: true,
      options,
    },
    global: {
      components: globalComponents,
    },
  })
}

describe('kitFormModal public contract', () => {
  it('associates labels, validates, and saves values', async () => {
    const wrapper = mountModal()
    const name = await screen.findByRole('textbox', { name: /项目名称/ })
    const status = screen.getByRole('combobox', { name: '状态' })
    const remark = screen.getByRole('textbox', { name: '备注' })

    expect((await axe(screen.getByRole('dialog'))).violations).toEqual([])

    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('此项为必填')).not.toBeNull()

    await fireEvent.update(name, '滨江壹号')
    await fireEvent.update(status, '进行中')
    await fireEvent.update(remark, '重点项目')
    expect(name.getAttribute('aria-invalid')).toBe('false')

    await fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(wrapper.emitted('save')).toEqual([[
      {
        name: '滨江壹号',
        status: '进行中',
        remark: '重点项目',
      },
    ]])
    wrapper.unmount()
  })

  it('resets drafts when a second request replaces options while open', async () => {
    const wrapper = mountModal({
      title: '第一次',
      fields: [{ key: 'name', label: '名称', value: '旧值' }],
    })

    const first = await screen.findByRole('textbox', { name: '名称' })
    await fireEvent.update(first, '未保存草稿')

    await wrapper.setProps({
      options: {
        title: '第二次',
        fields: [{ key: 'code', label: '编码', value: 'NEW-001' }],
      },
    })

    const second = await screen.findByRole('textbox', { name: '编码' })
    expect((second as HTMLInputElement).value).toBe('NEW-001')
    expect(screen.queryByDisplayValue('未保存草稿')).toBeNull()
    wrapper.unmount()
  })

  it('treats Escape as cancellation instead of saving a partial form', async () => {
    const wrapper = mountModal()
    await screen.findByRole('dialog')

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined()
    wrapper.unmount()
  })
})
