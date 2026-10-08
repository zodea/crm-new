import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h } from 'vue'
import Metric from '~/components/ui/Metric.vue'
import MetricGrid from '~/components/ui/MetricGrid.vue'
import RowActionMenu from '~/components/ui/RowActionMenu.vue'
import StatCard from '~/components/ui/StatCard.vue'

// 与已有浏览器组件套件一致，补齐 Nuxt 自动导入环境，不替代 DOM 或交互。
beforeEach(() => vi.stubGlobal('computed', computed))
afterEach(() => vi.unstubAllGlobals())

describe('共享指标与行菜单真实浏览器验收', () => {
  it('密排与独立卡片保留金额/未知状态，公式支持键盘打开关闭', async () => {
    await render(defineComponent({ setup: () => () => h('main', { style: { width: '100%', maxWidth: '900px' } }, [
      h(MetricGrid, null, { default: () => [
        h(Metric, { label: '已付工资', value: 0, money: true, formula: '同源原实发与补退，成员分配不另计现金。' }),
        h(Metric, { label: '历史工资', value: '尚不能确认', status: '待核对', missingSources: '原件未接通' }),
      ] }),
      h(StatCard, { label: '已发原单', value: 12, suffix: '份', clickable: true }),
    ]) }))
    await expect.element(page.getByText('¥0.00', { exact: true })).toBeVisible()
    await expect.element(page.getByText('尚不能确认', { exact: true })).toBeVisible()
    await expect.element(page.getByText('原件未接通', { exact: true })).toBeVisible()
    await userEvent.tab()
    const help = page.getByRole('button', { name: '查看已付工资说明' })
    await expect.element(help).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByRole('dialog')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(help).toHaveFocus()
    const action = page.getByRole('button', { name: '已发原单 12份' })
    await userEvent.tab()
    await expect.element(action).toHaveFocus()
    await page.screenshot({ path: `../../.tmp/opt02-ui/vue-metrics-${window.innerWidth}.png` })
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  })

  it('横滚区域内菜单通过 Portal 显示、避开视口边缘并保键盘焦点', async () => {
    await render(defineComponent({ setup: () => () => h('div', { style: { position: 'fixed', right: '12px', bottom: '12px', width: '180px', height: '40px', overflow: 'hidden' } }, [
      h(RowActionMenu, { label: '预算版本操作', items: [
        { key: 'blocked', label: '编辑冻结历史', disabled: true },
        { key: 'detail', label: '查看原版本' },
        { key: 'delete', label: '删除', tone: 'danger' },
      ] }),
    ]) }))
    const trigger = page.getByRole('button', { name: '预算版本操作' })
    await userEvent.tab()
    await expect.element(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const menu = page.getByRole('menu', { name: '预算版本操作' })
    await expect.element(menu).toBeVisible()
    await expect.element(page.getByRole('menuitem', { name: '查看原版本' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByRole('menuitem', { name: '删除' })).toHaveFocus()
    const box = menu.element().getBoundingClientRect()
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(window.innerWidth)
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
    await page.screenshot({ path: `../../.tmp/opt02-ui/vue-menu-${window.innerWidth}.png` })
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
    await expect.element(menu).not.toBeInTheDocument()
  })
})
