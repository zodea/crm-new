import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import ContextHelp from '~/components/ui/ContextHelp.vue'

describe('就近帮助的真实浏览器交互', () => {
  it('使用 Tab 聚焦显示短说明，Enter 打开详情，Escape 关闭并返回入口', async () => {
    await render(ContextHelp, { props: { label: '纳税人类型', text: '按核验结果选择纳税人类型。' } })
    const trigger = page.getByRole('button', { name: '查看纳税人类型说明' })

    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await expect.element(page.getByTestId('context-help-tooltip')).toBeVisible()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.element(page.getByTestId('context-help-tooltip')).not.toBeInTheDocument()
  })

  it.each([
    { corner: '右下', lines: 12, position: { right: '12px', bottom: '12px' } },
    { corner: '左上', lines: 36, position: { left: '12px', top: '12px' } },
  ])('靠近$corner点开 $lines 行说明时留在视口内，关闭按钮可实际点击', async ({ lines, position }) => {
    await render(ContextHelp, { props: { label: '金额口径', text: '按当前查询匹配记录汇总。\n'.repeat(lines) } })
    const trigger = page.getByRole('button', { name: '查看金额口径说明' })
    // 只改变被测入口的放置位置，弹层、几何测量和样式均使用真实实现。
    Object.assign((trigger.element() as HTMLElement).style, { position: 'fixed', ...position })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => {
      const box = dialog.element().getBoundingClientRect()
      return box.width > 200 && box.left >= 0 && box.right <= window.innerWidth
        && box.top >= 0 && box.bottom <= window.innerHeight
    }).toBe(true)
    await page.getByRole('button', { name: '关闭金额口径说明' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })
})
