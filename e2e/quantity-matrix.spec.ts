import { expect, test } from '@playwright/test'

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #103 Slice 2：只读工程量矩阵', () => {
  test('真实 seed 贯通路由、双视角和跨月阶段摘要', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('grid', { name: '工程量楼层房号矩阵' })).toBeVisible()
    await expect(page.getByText('路由: /subcontract/quantity · 待实现')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '工种矩阵' })).toHaveAttribute('data-state', 'active')

    await page.getByRole('tab', { name: '班组矩阵' }).click()
    const assigneeFilter = page.getByRole('combobox', { name: '班组/个人', exact: true })
    await expect(assigneeFilter).toBeVisible()
    await assigneeFilter.click()
    await page.getByRole('option', { name: '张建国（个人）', exact: true }).click()
    await page.getByRole('combobox', { name: '楼栋', exact: true }).click()
    await page.getByRole('option', { name: '2栋', exact: true }).click()
    await expect(page.getByText(/有责任或进度/)).toContainText('1 / 4 户')
    await expect(page.getByTestId('quantity-matrix-cell').first()).toHaveAccessibleName(/张建国/)
    await page.getByRole('combobox', { name: '楼栋', exact: true }).click()
    await page.getByRole('option', { name: '1栋', exact: true }).click()
    await page.getByRole('tab', { name: '工种矩阵' }).click()

    const cells = page.getByTestId('quantity-matrix-cell')
    await expect(cells).toHaveCount(4)
    await expect(cells.nth(1)).toContainText('草稿异常 1')
    await expect(cells.nth(1)).toHaveAccessibleName(/另有 1 条草稿异常/)
    const tabbable = await cells.evaluateAll(elements => elements.filter(element => element.getAttribute('tabindex') === '0').length)
    expect(tabbable).toBe(1)

    await cells.nth(0).focus()
    await cells.nth(0).press('ArrowRight')
    await expect(cells.nth(1)).toBeFocused()
    await cells.nth(1).press('ArrowDown')
    await expect(cells.nth(3)).toBeFocused()

    // 1层 01户在 5/6 月分别完成墙砖与地砖；总览只显示 6 月最近阶段，完整记录进入独立详情页。
    const monthFilter = page.getByRole('combobox', { name: '月份', exact: true })
    await monthFilter.click()
    await page.getByRole('option', { name: '2026年05月', exact: true }).click()
    await expect(cells.nth(2)).toContainText('墙砖铺贴')
    await monthFilter.click()
    await page.getByRole('option', { name: '全部月份', exact: true }).click()
    await expect(page.getByRole('option', { name: '全部月份', exact: true })).toHaveCount(0)
    await expect(monthFilter).toBeFocused()
    await cells.nth(2).focus()
    await expect(cells.nth(2)).toContainText('地砖铺贴')
    await cells.nth(2).press('Enter')
    const configure = page.getByRole('button', { name: '配置 101户' })
    const complete = page.getByRole('button', { name: '登记 101户' })
    const detail = page.getByRole('button', { name: '详情 101户' })
    await expect(configure).toBeFocused()
    await configure.press('Tab')
    await expect(complete).toBeFocused()
    await complete.press('Tab')
    await expect(detail).toBeFocused()
    await detail.click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\/[^/]+\/[^/?]+\?/)
    await expect(page.getByRole('heading', { name: /1栋 1层 101户/ })).toBeVisible()
    await page.getByRole('link', { name: '返回工程量矩阵' }).click()
    await expect(page.getByRole('combobox', { name: '月份', exact: true })).toHaveText(/全部月份/)
    expect(pageErrors).toEqual([])
  })

  test('无区域数据项目显示真实空态', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    await page.getByRole('combobox', { name: '项目', exact: true }).click()
    await page.getByRole('option', { name: /锦绣华庭/ }).click()

    await expect(page.getByText('当前项目尚未配置楼栋和户')).toBeVisible()
    await expect(page.getByRole('grid', { name: '工程量楼层房号矩阵' })).toHaveCount(0)
  })

  test('整工种批量完成展开到户×阶段并按缺照片规则回显草稿', async ({ page }) => {
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: '批量完成', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '整工种批量完成' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: '选择2层201户' }).first().check()
    await dialog.getByRole('button', { name: '展开阶段', exact: true }).click()
    await expect(dialog.getByText(/将提交 \d+ 项/)).toBeVisible()

    await dialog.getByRole('button', { name: '提交批量登记', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('提交结果（按阶段回显）')
    await expect(dialog.getByRole('status')).toContainText('存草稿 · 缺验收照片')
  })

  test('390px 页面不横滚且只有矩阵局部横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    const scroller = page.getByTestId('quantity-matrix-scroll')
    await expect(scroller).toBeVisible()
    const metrics = await scroller.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        client: element.clientWidth,
        scroll: element.scrollWidth,
        overflowX: style.overflowX,
      }
    })
    expect(metrics.scroll).toBeGreaterThan(metrics.client)
    expect(metrics.overflowX).toMatch(/auto|scroll/)
    await documentDoesNotOverflow(page)
  })

  test('量差总表读取真实三量并在窄屏浮层内局部横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    const trigger = page.getByRole('button', { name: '量差总表' })
    await trigger.click()
    const dialog = page.getByRole('dialog').filter({ hasText: '量差总表' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/不产生独立台账/)).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: '对比口径' })).toBeVisible()
    await expect(dialog.locator('[data-ui="kit-table"]')).toBeVisible()
    await documentDoesNotOverflow(page)

    const tableScroll = dialog.locator('[data-ui="kit-table"] .vxe-table--body-inner-wrapper').first()
    const widths = await tableScroll.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(widths.scroll).toBeGreaterThan(widths.client)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
