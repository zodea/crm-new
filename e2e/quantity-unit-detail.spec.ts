import { expect, test } from '@playwright/test'

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #103 Slice 6A：户施工详情', () => {
  test('矩阵时间线进入详情页，工种→阶段→日期与三量合计贯通', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    const cells = page.getByTestId('quantity-matrix-cell')
    await cells.nth(2).focus()
    await cells.nth(2).press('Enter')
    await page.getByRole('button', { name: '详情 101户' }).click()
    await page.getByRole('link', { name: /打开户施工详情/ }).click()

    await expect(page).toHaveURL(/\/subcontract\/quantity\/[^/]+\/[^/]+$/)
    await expect(page.getByRole('heading', { name: /1栋 1层 101户/ })).toBeVisible()

    // 工种 → 工序阶段 → 完成日期；墙砖/地砖、防水一遍/二遍分别成行。
    await expect(page.getByRole('region', { name: '泥水工施工记录' })).toContainText('墙砖铺贴')
    await expect(page.getByRole('region', { name: '泥水工施工记录' })).toContainText('地砖铺贴')
    await expect(page.getByRole('region', { name: '防水工施工记录' })).toContainText('防水一遍')
    await expect(page.getByRole('region', { name: '防水工施工记录' })).toContainText('防水二遍')

    // 当前责任与完成时执行责任同屏；毛利参考在单价落地前显示占位。
    await expect(page.getByText('完成时执行责任').first()).toBeVisible()
    await expect(page.getByText('待单价数据').first()).toBeVisible()
    await expect(page.getByRole('region', { name: '全户合计' })).toContainText('合同量')

    // 详情页可直接打开该阶段的完成登记。
    await page.getByRole('region', { name: '泥水工施工记录' }).getByRole('button', { name: '登记' }).first().click()
    await expect(page.getByRole('dialog').filter({ hasText: '阶段完成登记' })).toBeVisible()
    await page.keyboard.press('Escape')

    expect(pageErrors).toEqual([])
  })

  test('390px 页面无横滚，量明细仅自身局部横滚', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    const cells = page.getByTestId('quantity-matrix-cell')
    await cells.nth(2).focus()
    await cells.nth(2).press('Enter')
    await page.getByRole('button', { name: '详情 101户' }).click()
    await page.getByRole('link', { name: /打开户施工详情/ }).click()
    await expect(page.getByRole('heading', { name: /1栋 1层 101户/ })).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await documentDoesNotOverflow(page)

    const scrollableTables = await page.evaluate(() => (
      [...document.querySelectorAll('.overflow-x-auto')]
        .filter(element => element.scrollWidth > element.clientWidth)
        .length
    ))
    expect(scrollableTables).toBeGreaterThan(0)
  })

  test('直接访问不存在的户显示错误态', async ({ page }) => {
    await page.goto('/subcontract/quantity/proj_demo_001/not-a-unit')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('alert')).toContainText(/不属于当前项目|不存在/)
  })
})
