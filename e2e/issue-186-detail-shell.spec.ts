import { expect, test } from '@playwright/test'
import {
  expectInViewport,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  expectTabSequence,
} from './helpers/responsive'

const VIEWPORT_WIDTHS = [390, 768, 1024, 1280, 1440] as const
const VIEWPORT_HEIGHTS: Record<(typeof VIEWPORT_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1280: 900,
  1440: 1000,
}

test.describe('Issue #186：统一实体详情壳', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  })
  for (const state of [
    { button: '加载', role: 'status', title: '正在加载分供方详情演示' },
    { button: '空数据', role: 'status', title: '该分供方还没有业务数据' },
    { button: '无权限', role: 'status', title: '无权查看该分供方' },
    { button: '不存在', role: 'status', title: '分供方不存在或已删除' },
    { button: '错误', role: 'alert', title: '分供方详情加载失败' },
  ] as const) {
    test(`详情壳独立呈现 ${state.button} 状态与可用恢复动作`, async ({ page }) => {
      await page.goto('/dev/detail-shell')
      const controls = page.getByRole('group', { name: '详情壳状态预览' })

      await controls.getByRole('button', { name: state.button, exact: true }).click()
      const panel = page.getByRole(state.role, { name: state.title })
      await expect(panel).toBeVisible()
      await expect(page.getByRole('progressbar')).toHaveCount(0)
      if (state.button === '不存在') {
        await expect(page.getByRole('link', { name: '返回 KitUI 演示' }))
          .toHaveAttribute('href', '/dev/kit-ui')
      }
      if (state.role === 'alert') {
        await panel.getByRole('button', { name: '重新加载' }).click()
        await expect(page.getByRole('heading', {
          name: '华南区域机电设备与建筑辅材长期战略合作分供方有限公司',
        })).toBeVisible()
      }
      else {
        await expect(page.getByRole('alert')).toHaveCount(0)
      }
    })
  }

  for (const width of VIEWPORT_WIDTHS) {
    test(`长标题、业务页签与右栏在 ${width}px 保持可用`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/dev/detail-shell')

      const shell = page.locator('[data-ui="entity-detail-shell"]')
      const body = shell.locator('[data-ui="entity-detail-body"]')
      const heading = shell.getByRole('heading', {
        name: '华南区域机电设备与建筑辅材长期战略合作分供方有限公司',
      })
      await expect(heading).toBeVisible()
      await expect(shell.getByRole('complementary', { name: '文件与动态' })).toBeVisible()

      const columnCount = await body.evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
      )
      expect(columnCount).toBe(width >= 1280 ? 2 : 1)

      const tabs = page.getByRole('navigation', { name: '详情壳业务页签' })
      const firstTab = tabs.getByRole('tab', { name: '合同与结算事实 2', exact: true })
      await firstTab.focus()
      await page.keyboard.press('ArrowRight')
      await expect(tabs.getByRole('tab', { name: '跨项目收票与税额明细 1', exact: true }))
        .toHaveAttribute('aria-selected', 'true')

      await expectNoPageOverflow(page, `详情壳 @ ${width}px`)

      await page.goto('/base/supplier/sup_demo_004?origin=demo')
      const realShell = page.locator('[data-ui="entity-detail-shell"]')
      await expect(realShell.getByRole('heading', { name: '穗建五金机电经营部' }))
        .toBeVisible()
      const factTabs = page.getByRole('navigation', { name: '分供方业务事实' }).getByRole('tab')
      await expect(factTabs).toHaveText([/^\s*详细资料\s*$/, /^\s*合作项目\s*(?:\d+\s*)?$/, /^\s*支出合同\s*(?:\d+\s*)?$/, /^\s*支出结算\s*(?:\d+\s*)?$/, /^\s*收票登记\s*(?:\d+\s*)?$/, /^\s*付款管理\s*(?:\d+\s*)?$/])
      await expect(page.getByTestId('supplier-summary')).toContainText('累计合同金额')
      await expect(page.getByTestId('supplier-summary')).toContainText('¥261,250.00')
      await expectNoPageOverflow(page, `真实分供方详情 @ ${width}px`)
    })
  }

  test('窄窗键盘顺序稳定且密集子表只在自身区域横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/detail-shell')

    const back = page.getByRole('link', { name: '返回 KitUI 演示' })
    const compliance = page.getByRole('button', { name: '合规提醒' })
    const edit = page.getByRole('button', { name: '编辑', exact: true })
    await expectTabSequence(page, back, [compliance, edit], '详情壳头部操作')
    await expectInViewport(edit, '详情壳窄窗编辑操作')

    await expectLocalHorizontalScroll(
      page.getByTestId('detail-shell-table-scroll'),
      '详情壳密集子表',
    )
    await expectNoPageOverflow(page, '详情壳密集子表 @ 390px')
  })
})
