import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

const registries = [
  {
    path: '/base/customer',
    heading: '客户列表',
    record: '广州市政集团',
    detailPath: '/base/customer/customer_demo_013',
  },
  {
    path: '/base/crew',
    heading: '班组列表',
    record: '泥水A班',
    detailPath: '/base/crew/crew_demo_001',
  },
  {
    path: '/base/worker',
    heading: '工人列表',
    record: '张建国',
    detailPath: '/base/worker/wkr_demo_003',
  },
] as const

test.describe('Issue #194：客户、班组、工人列表', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 三类主数据保持紧凑工具栏和页面级无横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })

      for (const registry of registries) {
        await page.goto(registry.path)
        const toolbar = page.locator('[data-ui="master-data-list-toolbar"]')
        await expect(toolbar.getByRole('heading', { name: registry.heading }))
          .toBeVisible({ timeout: 30_000 })
        await expect(page.getByRole('link', { name: registry.record, exact: true }))
          .toHaveAttribute('href', registry.detailPath)
        await expectNoPageOverflow(page, `${registry.heading} @ ${width}px`)
      }
    })
  }

  test('窄窗表格和工具栏各自在局部承载横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    for (const registry of registries) {
      await page.goto(registry.path)
      await expect(page.getByRole('link', { name: registry.record, exact: true }))
        .toBeVisible({ timeout: 30_000 })
      await expectLocalHorizontalScroll(
        page.locator('[data-ui="master-data-list-table"] .vxe-table--body-inner-wrapper').first(),
        `${registry.heading}表格`,
      )
      await expectNoPageOverflow(page, `${registry.heading}窄窗`)
    }
  })

  test('键盘可从列表进入详情，搜索无结果后可清除筛选', async ({ page }) => {
    await page.goto('/base/worker')

    const workerLink = page.getByRole('link', { name: '张建国', exact: true })
    await expect(workerLink).toBeVisible({ timeout: 30_000 })
    await workerLink.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL('/base/worker/wkr_demo_003')

    await page.goto('/base/worker')
    const search = page.getByPlaceholder('搜索工人姓名、工种、班组、项目或证件…')
    await search.fill('绝对不存在的工人')
    await expect(page.getByText('没有符合条件的工人').last()).toBeVisible()
    await page.getByRole('button', { name: '清除筛选' }).last().click()
    await expect(page.getByRole('link', { name: '张建国', exact: true })).toBeVisible()
  })
})
