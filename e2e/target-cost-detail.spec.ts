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
      await page.goto('/project/target-cost/not-exists?origin=real')

      await expect(page.getByRole('status', { name: '目标成本版本不存在或不可用' }))
        .toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: '返回目标成本列表', exact: true }).click()
      await expect(page).toHaveURL(/\/project\/target-cost\?origin=real/)
      await expectNoPageOverflow(page, `目标成本详情缺失态 @ ${width}px`)
    })
  }
})
