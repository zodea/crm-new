import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

test.describe('Issue #195：通用合同详情', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示施工合同阶段、金额和真实关联单据`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/contract/con_demo_sg01')

      await expect(page.getByRole('heading', { name: '合和新城施工总承包合同' }))
        .toBeVisible({ timeout: 15_000 })
      await expect(page.getByTitle('RJ-HHXC-SG-2025001')).toBeVisible()
      await expect(page.getByRole('region', { name: /合同阶段/ })).toBeVisible()
      await expect(page.locator('[aria-current="step"]')).toContainText('履约')
      await expect(page.getByText('¥32,388,422.00', { exact: true })).toBeVisible()

      const documentsTab = page.getByRole('tab', { name: /关联单据/ })
      await documentsTab.click()
      await expect(page.getByTestId('contract-documents-scroll')).toBeVisible()
      await expect(page.getByRole('link', { name: '2026-06', exact: true }))
        .toHaveAttribute('href', '/owner/report/monthly_statement_demo_001')
      await expectNoPageOverflow(page, `合同详情 @ ${width}px`)
    })
  }

  test('窄窗业务页签支持键盘切换，关联单据仅在表格内部横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/contract/con_demo_sg01')

    const infoTab = page.getByRole('tab', { name: '基本信息' })
    const documentsTab = page.getByRole('tab', { name: /关联单据/ })
    await infoTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(documentsTab).toHaveAttribute('aria-selected', 'true')
    await expectLocalHorizontalScroll(
      page.getByTestId('contract-documents-scroll')
        .locator('.vxe-table--scroll-x-handle')
        .first(),
      '合同关联单据表',
    )
    await expectNoPageOverflow(page, '合同详情窄窗')
  })

  test('材料采购合同保留专有采购明细页签，不出现变洽签页签', async ({ page }) => {
    await page.goto('/contract/con_demo_cg01')

    await expect(page.getByRole('heading', { name: '瓷砖采购合同' }))
      .toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('tab', { name: /采购明细/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: /变洽签/ })).toHaveCount(0)
  })
})
