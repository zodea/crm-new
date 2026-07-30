import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

test.describe('Issue #194：客户详情', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示真实客户关系且页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHTS[width] })
      await page.goto('/base/customer/customer_demo_001')

      const shell = page.locator('[data-ui="entity-detail-shell"]')
      await expect(shell.getByRole('heading', { name: '合和地产集团' }))
        .toBeVisible({ timeout: 30_000 })
      await expect(shell.getByRole('link', { name: '编辑客户' }))
        .toHaveAttribute('href', '/base/customer/form/customer_demo_001')
      await expect(shell.getByRole('tab', { name: /名下项目/ })).toBeVisible()
      await expect(shell.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001')
      await expectNoPageOverflow(page, `客户详情 @ ${width}px`)
    })
  }

  test('窄窗切换施工合同和收款后仍由表格局部横滚并保留下钻', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/customer/customer_demo_001')

    await page.getByRole('tab', { name: /施工合同/ }).click()
    await expect(page.getByRole('link', { name: '合和新城施工总承包合同' }))
      .toHaveAttribute('href', '/contract/con_demo_sg01')
    await expectLocalHorizontalScroll(
      page.locator('[data-ui="kit-table"] .vxe-table--body-inner-wrapper').first(),
      '客户施工合同表',
    )

    await page.getByRole('tab', { name: /收款明细/ }).click()
    await expect(page.getByRole('link', { name: 'SK-2026-001' }))
      .toHaveAttribute('href', '/finance/receipt/rr_mz0x1_0')
    await expectLocalHorizontalScroll(
      page.locator('[data-ui="kit-table"] .vxe-table--body-inner-wrapper').first(),
      '客户收款表',
    )
    await expectNoPageOverflow(page, '客户详情窄窗')
  })

  test('业务页签支持深链、方向键切换并同步地址', async ({ page }) => {
    await page.goto('/base/customer/customer_demo_001?tab=contracts&from=list')

    const contractTab = page.getByRole('tab', { name: /施工合同/ })
    const receiptTab = page.getByRole('tab', { name: /收款明细/ })
    await expect(contractTab).toHaveAttribute('aria-selected', 'true')
    await contractTab.focus()
    await page.keyboard.press('ArrowRight')

    await expect(receiptTab).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=receipts/)
    await expect(page).toHaveURL(/from=list/)
    await expect(page.getByRole('link', { name: 'SK-2026-001' }))
      .toHaveAttribute('href', '/finance/receipt/rr_mz0x1_0')
  })

  test('不存在的客户展示不存在状态并保留返回入口', async ({ page }) => {
    await page.goto('/base/customer/not-exists')

    await expect(page.getByRole('status', { name: '客户不存在或已删除' })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回客户列表' }))
      .toHaveAttribute('href', '/base/customer')
  })
})
