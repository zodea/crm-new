import type { QuantityVarianceFact } from '~/lib/quantity/variance'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import ProjectListToolbar from '~/components/project/ProjectListToolbar.vue'
import QuantityVarianceDialog from '~/components/quantity/QuantityVarianceDialog.vue'
import ScheduleProcessLibraryTaskEditor from '~/components/schedule/ScheduleProcessLibraryTaskEditor.vue'
import ScheduleTemplateGanttEditor from '~/components/schedule/ScheduleTemplateGanttEditor.vue'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '~/components/ui/dialog'
import SearchInput from '~/components/ui/SearchInput.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'

afterEach(() => vi.unstubAllGlobals())

describe('共享弹窗关闭按钮的真实浏览器焦点', () => {
  it.each([
    { direction: '向后 Tab', shift: false },
    { direction: '向前 Shift+Tab', shift: true },
  ])('$direction 到关闭按钮时显示品牌焦点，Escape 返回入口', async ({ shift }) => {
    await render(defineComponent({
      setup: () => () => h(Dialog, null, {
        default: () => [
          h(DialogTrigger, { asChild: true }, { default: () => h('button', '打开共享弹窗') }),
          h(DialogContent, { showClose: true, class: 'w-[min(440px,92vw)] p-5' }, {
            default: () => [
              h(DialogTitle, null, { default: () => '键盘焦点验证' }),
              h(DialogDescription, null, { default: () => '关闭按钮保持可见的键盘焦点。' }),
              h('input', { 'aria-label': '说明', 'class': 'field-input' }),
            ],
          }),
        ],
      }),
    }))
    const trigger = page.getByRole('button', { name: '打开共享弹窗' })
    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog', { name: '键盘焦点验证' })
    await expect.element(dialog).toBeVisible()
    await expect.element(page.getByRole('textbox', { name: '说明' })).toHaveFocus()
    const close = page.getByRole('button', { name: '关闭', exact: true })
    const before = getComputedStyle(close.element())
    const unfocused = { outlineColor: before.outlineColor, outlineStyle: before.outlineStyle }
    expect(close.element().matches(':hover')).toBe(false)
    expect(close.element().matches(':focus-visible')).toBe(false)
    await userEvent.tab({ shift })
    await expect.element(close).toHaveFocus()
    const focused = getComputedStyle(close.element())
    const brand = document.createElement('span')
    brand.style.color = 'var(--brand)'
    document.body.append(brand)
    const brandColor = getComputedStyle(brand).color
    brand.remove()
    expect(close.element().matches(':focus-visible')).toBe(true)
    expect(close.element().matches(':hover')).toBe(false)
    expect(focused.outlineStyle).toBe('solid')
    expect(focused.outlineWidth).toBe('2px')
    expect(focused.outlineColor).toBe(brandColor)
    expect({ outlineColor: focused.outlineColor, outlineStyle: focused.outlineStyle }).not.toEqual(unfocused)
    expect(focused.borderTopWidth).toBe('0px')
    expect(focused.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })
})

describe('响应式控件使用真实浏览器几何', () => {
  it.each([
    { width: 160, containerWidth: 300 },
    { width: 560, containerWidth: 300 },
  ])('搜索宽度 $width 在 $containerWidth 容器内收敛，输入填满容器', async ({ width, containerWidth }) => {
    await render(defineComponent({
      setup: () => () => h('main', { style: { maxWidth: `${containerWidth}px` } }, [
        h(SearchInput, { modelValue: '', width, placeholder: '检索项目' }),
      ]),
    }))
    const input = page.getByRole('searchbox', { name: '检索项目' }).element()
    const wrapper = input.parentElement!
    const host = wrapper.parentElement!
    expect(wrapper.getBoundingClientRect().width).toBeCloseTo(Math.min(width, host.clientWidth), 0)
    expect(input.getBoundingClientRect().width).toBeCloseTo(wrapper.getBoundingClientRect().width, 0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it.each(['项目工具栏', '工序编辑表', '模板甘特'] as const)('%s 的宽内容在自身区域横向滚动', async (surface) => {
    const tasks = [{ key: 'setting-out', name: '放线', durationDays: 3, trade: '泥水工', color: '#8b5cf6', stageCode: '', itemCodes: [], predecessorKey: null }]
    const rows = [{ key: 'setting-out', name: '放线', trade: '泥水工', color: '#8b5cf6', plannedStart: '2026-07-01', plannedFinish: '2026-07-03' }]
    const components = {
      项目工具栏: () => h(ProjectListToolbar, { search: '', realTotal: 12, demoTotal: 0, includeDemo: false, visible: 12, loading: false, sortMode: 'updated-desc', filtersVisible: true, density: 'compact' }),
      工序编辑表: () => h(ScheduleProcessLibraryTaskEditor, { tasks }),
      模板甘特: () => h(ScheduleTemplateGanttEditor, { rows }),
    }
    const ids = { 项目工具栏: 'project-list-toolbar-scroll', 工序编辑表: 'process-library-task-scroll', 模板甘特: 'template-gantt-scroll' }
    await render(defineComponent({ setup: () => () => h('main', { style: { maxWidth: '320px' } }, [components[surface]()]) }), { global: { components: { SearchInput } } })
    const scroll = document.querySelector<HTMLElement>(`[data-testid="${ids[surface]}"]`)!
    expect(getComputedStyle(scroll).overflowX).toBe('auto')
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
    scroll.scrollLeft = scroll.scrollWidth
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it.each([0, 20])('量差弹窗 %s 条明细保持内容和关闭操作可达', async (count) => {
    const fact: QuantityVarianceFact = { id: 'fact', buildingId: 'building-a', buildingName: 'A 栋', buildingSortOrder: 1, itemId: 'item-a', itemName: '墙砖', itemSortOrder: 1, section: '装饰装修', trade: '泥水工', unit: '㎡', contractQty: 10, provisionalQty: 12, fieldQty: 11, effectiveUnitPrice: 100, updatedAt: '2026-07-30T00:00:00Z' }
    const loadVariance = vi.fn().mockResolvedValue(Array.from({ length: count }, (_, index) => ({ ...fact, id: `fact-${index}`, itemId: `item-${index}` })))
    vi.stubGlobal('useQuantityStore', () => ({ loadVariance }))
    const table = defineComponent({ setup: () => () => h('div', { style: { height: '100%', overflow: 'auto' } }, '量差明细') })
    const rendered = await render(QuantityVarianceDialog, { props: { open: false, projectId: 'project-a' }, global: { components: { KitTable: table, SelectFilter } } })
    await rendered.rerender({ open: true })
    const dialog = page.getByRole('dialog')
    await expect.element(dialog).toBeVisible()
    await expect.poll(() => loadVariance.mock.calls).toEqual([['project-a', 'real']])
    const scroll = page.getByTestId('quantity-variance-scroll').element() as HTMLElement
    const region = page.getByTestId('quantity-variance-table').element() as HTMLElement
    expect(getComputedStyle(scroll).overflowY).toBe('auto')
    expect(region.clientHeight).toBeGreaterThan(0)
    const box = dialog.element().getBoundingClientRect()
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(window.innerWidth)
    const close = page.getByRole('button', { name: '关闭', exact: true })
    await close.click()
    expect(rendered.emitted()['update:open']).toEqual([[false]])
  })
})
