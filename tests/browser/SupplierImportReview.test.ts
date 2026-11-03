import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import SupplierImportReview from '~/components/supplier/SupplierImportReview.vue'

const entries = Array.from({ length: 11 }, (_, index) => ({
  index,
  rowNumber: index + 2,
  row: { name: `合成公司${index}`, contact: '新联系人' },
  preview: { fingerprint: 'a'.repeat(64), candidates: [{ id: `supplier-${index}`, version: '1', name: `已有公司${index}`, matchedBy: ['name'] as Array<'name'>, fields: { name: `已有公司${index}`, contact: '原联系人' } }] },
  sameFileRows: [],
}))
const fields = [{ key: 'name', label: '名称' }, { key: 'contact', label: '联系人' }]

it('键盘访问下一页并选择替换，焦点和差异可见', async () => {
  const choose = vi.fn()
  await render(SupplierImportReview, { props: { entries, fields, choices: {}, locked: false, onChoose: choose } })
  const next = page.getByRole('button', { name: '下一页' })
  ;(next.element() as HTMLElement).focus()
  await expect.element(next).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('已有：已有公司10（公司名称匹配）')).toBeVisible()
  await expect.element(page.getByText('原联系人')).toBeVisible()
  await expect.element(page.getByText('新联系人')).toBeVisible()
  const select = page.getByLabelText('第 12 行处理方式')
  ;(select.element() as HTMLElement).focus()
  await expect.element(select).toHaveFocus()
  await userEvent.keyboard('{End}')
  expect(choose).toHaveBeenCalledWith(10, 'replace:supplier-10')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})

it('窄容器内对比表自行横向滚动，页面不横向溢出', async () => {
  await render(defineComponent({ setup: () => () => h('main', { style: { width: 'min(320px, 100%)' } }, [h(SupplierImportReview, { entries: entries.slice(0, 1), fields, choices: {}, locked: false })]) }))
  const scroll = page.getByLabelText('已有资料与导入内容对比').element() as HTMLElement
  expect(getComputedStyle(scroll).overflowX).toBe('auto')
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
  scroll.focus()
  expect(document.activeElement).toBe(scroll)
  scroll.scrollLeft = scroll.scrollWidth
  await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
