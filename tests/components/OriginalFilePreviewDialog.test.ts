import { fireEvent, render, screen, within } from '@testing-library/vue'
import { expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import OriginalFilePreviewDialog from '~/components/shared/OriginalFilePreviewDialog.vue'

it('原件弹窗显示读取状态与正文，按 Escape 关闭并交还原按钮焦点', async () => {
  const open = shallowRef(false)
  const url = shallowRef<string>()
  const busy = shallowRef(true)
  let trigger: HTMLElement
  const restoreFocus = vi.fn((event: Event) => {
    event.preventDefault()
    trigger.focus()
  })
  render(defineComponent({
    setup: () => () => [
      h('button', { type: 'button', onClick: () => { open.value = true } }, '预览原件'),
      h(OriginalFilePreviewDialog, {
        'open': open.value,
        'title': '历史报价.txt',
        'description': '报价版本原件只读预览',
        'url': url.value,
        'mime': 'text/plain',
        'busy': busy.value,
        'problem': '',
        'loadingTitle': '正在读取原件',
        'compact': true,
        'onUpdate:open': (value) => { open.value = value },
        'onCloseAutoFocus': restoreFocus,
      }),
    ],
  }))

  trigger = screen.getByRole('button', { name: '预览原件' })
  await fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: '历史报价.txt' })
  expect(within(dialog).getByText('报价版本原件只读预览')).toBeTruthy()
  expect(within(dialog).getByRole('status', { name: '正在读取原件' }).getAttribute('aria-busy')).toBe('true')

  url.value = 'blob:test-original'
  busy.value = false
  const frame = await within(dialog).findByTitle('历史报价.txt')
  expect(frame.tagName).toBe('IFRAME')
  expect(frame.getAttribute('src')).toBe(url.value)

  await fireEvent.keyDown(dialog, { key: 'Escape' })
  await vi.waitFor(() => {
    expect(open.value).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(restoreFocus).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })
})
