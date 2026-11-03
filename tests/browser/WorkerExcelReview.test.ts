import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import WorkerExcelReview from '~/components/crew-worker/WorkerExcelReview.vue'

const entries = Array.from({ length: 11 }, (_, index) => ({
  index,
  rowNumber: index + 2,
  row: { name: `合成人${index}`, crewName: '合成班组', projectName: '合成项目' },
  sameFileRows: [],
  preview: { fingerprint: 'a'.repeat(64), candidates: [{ id: `worker-${index}`, name: `合成人${index}`, version: '1', matchedBy: ['name'] as Array<'name'>, fields: { name: `合成人${index}`, crewName: '旧班组', projectName: null } }], crews: [{ id: 'crew-1', name: '合成班组', version: '1' }, { id: 'crew-2', name: '合成班组', version: '1' }], projects: [{ id: 'project-1', name: '合成项目', version: '1' }] },
}))
const fields = [{ key: 'name', label: '姓名' }, { key: 'crewName', label: '所属班组' }, { key: 'projectName', label: '当前项目' }]
it('键盘分页并选择工人与关联对象，焦点与对比可见', async () => {
  const choose = vi.fn()
  const relation = vi.fn()
  await render(WorkerExcelReview, { props: { entries, fields, choices: {}, relations: {}, locked: false, onChoose: choose, onRelation: relation } })
  const next = page.getByRole('button', { name: '下一页' })
  ;(next.element() as HTMLElement).focus()
  await expect.element(next).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('旧班组')).toBeVisible()
  for (const label of ['第 12 行处理方式', '第 12 行所属班组', '第 12 行当前项目']) {
    const select = page.getByLabelText(label)
    ;(select.element() as HTMLElement).focus()
    await expect.element(select).toHaveFocus()
    await userEvent.keyboard('{End}')
  }
  expect(choose).toHaveBeenCalledWith(10, 'replace:worker-10')
  expect(relation).toHaveBeenCalledWith(10, 'crew', 'crew-2')
  expect(relation).toHaveBeenCalledWith(10, 'project', 'project-1')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
it('窄区域的对比表独立横向滚动', async () => {
  await render(defineComponent({ setup: () => () => h('main', { style: { width: 'min(320px, 100%)' } }, [h(WorkerExcelReview, { entries: entries.slice(0, 1), fields, choices: {}, relations: {}, locked: false })]) }))
  const scroll = page.getByLabelText('已有工人与导入内容对比').element() as HTMLElement
  expect(getComputedStyle(scroll).overflowX).toBe('auto')
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
  scroll.focus()
  expect(document.activeElement).toBe(scroll)
  scroll.scrollLeft = scroll.scrollWidth
  await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
})
