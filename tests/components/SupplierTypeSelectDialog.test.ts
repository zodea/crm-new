import { fireEvent, screen } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SupplierTypeSelectDialog from '~/components/supplier/SupplierTypeSelectDialog.vue'
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

describe('supplierTypeSelectDialog', () => {
  it('只选择权威七类并在确认后返回所选类别', async () => {
    const view = mount(SupplierTypeSelectDialog, {
      attachTo: document.body,
      props: {
        open: true,
      },
      global: {
        components: {
          Button,
          Dialog,
          DialogContent,
          DialogDescription,
          DialogTitle,
        },
      },
    })

    await vi.waitFor(() => {
      expect(screen.getByRole('dialog', { name: '选择分供方类别' })).not.toBeNull()
    })
    expect(screen.getAllByRole('radio')).toHaveLength(SUPPLIER_CATEGORIES.length)
    expect((screen.getByRole('radio', { name: '材料供应商' }) as HTMLInputElement).checked).toBe(true)

    await fireEvent.click(screen.getByRole('radio', { name: '专业分包商' }))
    await fireEvent.click(screen.getByRole('button', { name: '进入新建表单' }))

    expect(view.emitted().confirm).toEqual([['专业分包商']])
    expect(view.emitted()['update:open']).toEqual([[false]])
    view.unmount()
  })

  it('取消只关闭类型选择，不产生实体字段提交', async () => {
    const view = mount(SupplierTypeSelectDialog, {
      attachTo: document.body,
      props: {
        open: true,
      },
      global: {
        components: {
          Button,
          Dialog,
          DialogContent,
          DialogDescription,
          DialogTitle,
        },
      },
    })

    await fireEvent.click(await screen.findByRole('button', { name: '取消' }))

    expect(view.emitted().confirm).toBeUndefined()
    expect(view.emitted()['update:open']).toEqual([[false]])
    view.unmount()
  })
})
