import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'

describe('多选筛选器的真实浏览器交互', () => {
  it('键盘打开、Space 选择，Escape 丢弃草稿，重新选择并应用才提交', async () => {
    const update = vi.fn()
    await render(KitMultiSelectFilter, { props: {
      'label': '合同状态',
      'modelValue': [],
      'options': [{ key: 'draft', label: '草稿' }, { key: 'signed', label: '已签订' }],
      'onUpdate:modelValue': update,
    } })
    const trigger = page.getByRole('button', { name: '合同状态，已选 0 项' })
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await expect.element(page.getByRole('button', { name: '全选', exact: true })).toHaveFocus()
    await userEvent.tab() // 跳过禁用的“清空”，到“不限”。
    await userEvent.tab() // 到“草稿”。
    const draft = page.getByRole('checkbox', { name: '草稿', exact: true })
    await expect.element(draft).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect.element(draft).toBeChecked()
    expect(update).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(update).not.toHaveBeenCalled()

    await trigger.click()
    await expect.element(draft).not.toBeChecked()
    await draft.click()
    await page.getByRole('button', { name: '应用', exact: true }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith(['draft'])
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it('长候选列表由弹层内部滚动，末项可选择且页面不横向溢出', async () => {
    const update = vi.fn()
    await render(KitMultiSelectFilter, { props: {
      'label': '项目',
      'modelValue': [],
      'options': Array.from({ length: 40 }, (_, i) => ({ key: `p${i + 1}`, label: `项目 ${i + 1}` })),
      'onUpdate:modelValue': update,
    } })
    await page.getByRole('button', { name: '项目，已选 0 项' }).click()
    const last = page.getByRole('checkbox', { name: '项目 40', exact: true })
    // Playwright 的实际点击会滚动候选容器，不调用 mock scrollIntoView。
    await last.click()
    await expect.element(last).toBeChecked()
    const list = last.element().closest('label')!.parentElement!
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    expect(list.scrollTop).toBeGreaterThan(0)
    expect(window.scrollY).toBe(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await page.getByRole('button', { name: '应用', exact: true }).click()
    expect(update).toHaveBeenCalledExactlyOnceWith(['p40'])
  })
})
