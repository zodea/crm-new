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

test.describe('Issue #203：付款管理', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示真实批复、已确认支付和应付余额，页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/finance/payment-management')

      const toolbar = page.locator('[data-ui="payment-management-toolbar"]')
      await expect(toolbar.getByRole('heading', { name: '付款管理' }))
        .toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('group', { name: '应付余额' })).toBeVisible()
      await expect(page.getByRole('tab', { name: /待支付 2/ })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeVisible()
      await expect(page.getByText('灯具采购结清请款', { exact: true })).toBeVisible()
      await expectNoPageOverflow(page, `付款管理 @ ${width}px`)
    })
  }

  test('搜索、项目筛选和业务态切换共享同一真实数据管线', async ({ page }) => {
    await page.goto('/finance/payment-management')
    const search = page.getByPlaceholder('搜索申请名称、编号或收款单位')

    await search.fill('首期请款')
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeVisible()
    await expect(page.getByText('灯具采购结清请款', { exact: true })).toBeHidden()

    await search.fill('')
    await page.getByRole('tab', { name: /已付清 1/ }).click()
    await expect(page.getByText('项目进度付款申请', { exact: true })).toBeVisible()
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeHidden()

    const paidTab = page.getByRole('tab', { name: /已付清 1/ })
    await paidTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /全部 3/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('窄窗宽表只在表格自身横滚，登记支付仅导航到整页表单', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/finance/payment-management')
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeVisible()

    const tableScroll = page.locator(
      '[data-testid="payment-management-table"] .vxe-table--scroll-x-handle',
    )
    await expectLocalHorizontalScroll(tableScroll, '付款管理表')

    const action = page.getByRole('button', {
      name: '五金机电采购首期请款付款操作',
    })
    await action.click()
    await page.getByRole('menuitem', { name: '登记支付记录' }).click()

    await expect(page).toHaveURL(/\/finance\/records\/new\?/)
    await expect(page).toHaveURL(/paymentApplicationId=pa_demo_sup004_1/)
    await expect(page.getByRole('heading', { name: /新建 · 支付记录/ })).toBeVisible()
    await expect(page.getByTestId('finance-amount')).toHaveValue('20000')
  })

  test('付款申请详情展示真实勾稽洞察，并能回填登记支付流程', async ({ page }) => {
    await page.goto('/finance/payment/pa_demo_sup004_1/detail')

    await expect(page.getByRole('heading', { name: '五金机电采购首期请款' })).toBeVisible()
    await expect(page.getByTestId('payment-application-insight')).toBeVisible()
    await expect(page.getByText('跨项目/分供方付款', { exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '待支付' })).toContainText('¥20,000.00')

    await page.getByTestId('payment-application-edit').click()
    await expect(page).toHaveURL('/finance/payment/pa_demo_sup004_1')
    await expect(page.getByRole('heading', { name: /编辑 · 付款申请/ })).toBeVisible()

    await page.goto('/finance/payment/pa_demo_sup004_1/detail')
    await page.getByTestId('payment-application-create-payment').click()
    await expect(page).toHaveURL(/\/finance\/records\/new\?/)
    await expect(page).toHaveURL(/paymentApplicationId=pa_demo_sup004_1/)
    await expect(page.getByTestId('finance-amount')).toHaveValue('20000')
  })
})
