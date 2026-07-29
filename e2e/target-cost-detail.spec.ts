import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

test.describe('Issue #191：目标成本详情', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 缺失版本保留返回入口且页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/project/target-cost/not-exists')

      await expect(page.getByRole('status', { name: '目标成本版本不存在或已删除' }))
        .toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('link', { name: '返回目标成本列表' }))
        .toHaveAttribute('href', '/project/target-cost')
      await expectNoPageOverflow(page, `目标成本详情缺失态 @ ${width}px`)
    })
  }
})
