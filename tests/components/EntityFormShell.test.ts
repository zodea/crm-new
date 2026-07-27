import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'

describe('entityFormShell', () => {
  it('lays out the header, section navigation, caller content and sticky action slot', async () => {
    const view = render(EntityFormShell, {
      props: {
        title: '编辑 · 分供方',
        subtitle: '草稿可暂存不完整内容。',
        backLabel: '返回分供方列表',
        sections: [
          { key: 'basic', label: '基础信息' },
          { key: 'contact', label: '联系人信息' },
          { key: 'attachments', label: '证照附件' },
        ],
      },
      slots: {
        status: '<span>草稿</span>',
        actions: '<button type="button">附加操作</button>',
        default: '<form><input aria-label="公司全称"><section id="section-basic">字段内容</section><section id="section-contact">联系人字段</section></form>',
        footer: '<button type="button">保存</button>',
      },
    })

    expect(screen.getByRole('heading', { name: '编辑 · 分供方' })).not.toBeNull()
    expect(screen.getByRole('navigation', { name: '表单分区' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '附加操作' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '保存' })).not.toBeNull()
    expect(screen.queryByRole('main')).toBeNull()

    const contact = screen.getByRole('link', { name: '联系人信息' })
    await fireEvent.click(contact)
    expect(contact.getAttribute('aria-current')).toBe('location')
    expect(window.location.hash).toBe('')

    await fireEvent.click(screen.getByRole('button', { name: '返回分供方列表' }))
    expect(view.emitted().back).toHaveLength(1)
  })

  it('uses the shared loading and error surfaces without rendering form actions early', async () => {
    const view = render(EntityFormShell, {
      props: {
        title: '编辑 · 分供方',
        state: 'loading',
        stateTitle: '正在载入分供方表单',
      },
      slots: {
        default: '<input aria-label="公司全称">',
        footer: '<button type="button">保存</button>',
      },
    })

    expect(screen.getByRole('status', { name: '正在载入分供方表单' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()

    await view.rerender({
      title: '编辑 · 分供方',
      state: 'error',
      stateTitle: '分供方表单载入失败',
      stateDescription: '数据库暂时不可用。',
      stateActionLabel: '重新加载',
    })
    expect(screen.getByRole('alert', { name: '分供方表单载入失败' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(view.emitted().stateAction).toHaveLength(1)
  })
})
