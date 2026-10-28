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
  test.setTimeout(90_000)
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
  })

  test('展示真实批复、已确认支付和应付余额，各宽度页面不横向溢出', async ({ page }) => {
    await page.goto('/finance/payment-management')

    const toolbar = page.locator('[data-ui="payment-management-toolbar"]')
    await expect(toolbar.getByRole('heading', { name: '付款管理' }))
      .toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('group', { name: '应付余额' })).toBeVisible()
    await expect(page.getByRole('button', { name: '付款状态，已选 1 项' })).toContainText('待支付')
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeVisible()
    await expect(page.getByText('灯具采购结清请款', { exact: true })).toBeVisible()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await expectNoPageOverflow(page, `付款管理 @ ${width}px`)
    }
  })

  test('搜索、项目筛选和业务态切换共享同一真实数据管线', async ({ page }) => {
    await page.goto('/finance/payment-management')
    const search = page.getByPlaceholder('搜索申请名称、编号或收款单位')

    await search.fill('首期请款')
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeVisible()
    await expect(page.getByText('灯具采购结清请款', { exact: true })).toBeHidden()

    await search.fill('')
    await page.getByRole('button', { name: '付款状态，已选 1 项' }).click()
    await page.getByRole('checkbox', { name: '待支付', exact: true }).uncheck()
    await page.getByRole('checkbox', { name: '已付清', exact: true }).check()
    await page.getByRole('button', { name: '应用', exact: true }).click()
    await expect(page.getByText('项目进度付款申请', { exact: true })).toBeVisible()
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeHidden()

    const paidFilter = page.getByRole('button', { name: '付款状态，已选 1 项' })
    await paidFilter.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '清除', exact: true }).click()
    await expect(page.getByRole('button', { name: '付款状态，已选 0 项' })).toContainText('不限')
  })

  test('窄窗宽表只在表格自身横滚，测试来源仅可查看且禁止登记正式支付', async ({ page }) => {
    const writes: string[] = []
    page.on('request', request => request.method() === 'POST' && request.url().includes('/api/commands/finance') && writes.push(request.url()))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/finance/payment-management')
    await expect(page.getByText('五金机电采购首期请款', { exact: true })).toBeVisible()
    await expect(page.getByText('当前为测试数据，只读查看；正式付款请切回实际来源。', { exact: true })).toBeVisible()

    const tableScroll = page.locator(
      '[data-testid="payment-management-table"] .vxe-table--scroll-x-handle',
    )
    await expectLocalHorizontalScroll(tableScroll, '付款管理表')

    const action = page.getByRole('button', {
      name: '五金机电采购首期请款付款操作',
    })
    await action.focus()
    await expect(action).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: '登记支付记录', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: '查看付款申请', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\/payment\/pa_demo_sup004_1\/detail/)
    await expect(page.getByRole('alert', { name: '付款申请详情加载失败', exact: true })).toContainText('当前为测试数据来源，不能使用正式财务记录或原提交')
    await expect(page.getByTestId('payment-application-edit')).toHaveCount(0)
    await expect(page.getByTestId('payment-application-create-payment')).toHaveCount(0)
    expect(writes).toEqual([])
  })

  test('测试来源不能读取正式付款详情、编辑或登记，重新读取保持来源门禁', async ({ page }) => {
    const writes: string[] = []
    page.on('request', request => request.method() === 'POST' && request.url().includes('/api/commands/finance') && writes.push(request.url()))
    await page.goto('/finance/payment/pa_demo_sup004_1/detail')
    const unavailable = page.getByRole('alert', { name: '付款申请详情加载失败', exact: true })
    await expect(unavailable).toContainText('当前为测试数据来源，不能使用正式财务记录或原提交')
    await expect(page.getByTestId('payment-application-insight')).toHaveCount(0)
    await expect(page.getByTestId('payment-application-edit')).toHaveCount(0)
    await expect(page.getByTestId('payment-application-create-payment')).toHaveCount(0)
    const retry = unavailable.getByRole('button', { name: '重新加载', exact: true })
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `测试来源付款详情门禁 @ ${width}px`)
      await retry.focus()
      await expect(retry).toBeFocused()
    }
    await page.keyboard.press('Enter')
    await expect(unavailable).toContainText('当前为测试数据来源，不能使用正式财务记录或原提交')
    await expect(page.getByTestId('payment-application-edit')).toHaveCount(0)
    await expect(page.getByTestId('payment-application-create-payment')).toHaveCount(0)
    expect(writes).toEqual([])
  })
})
