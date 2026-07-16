import { expect, test } from '@playwright/test'

test.describe('精确因子组合工作台', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/finance/invoice/factor', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('factor-workbench')).toBeVisible({ timeout: 15_000 })
  })

  test('精确求解、筛选和小数数量形成完整闭环', async ({ page }) => {
    const calculateButton = page.getByTestId('factor-calculate')
    const resultRows = page.locator('[data-testid="factor-workbench"] tbody tr')

    await calculateButton.click()
    await expect(resultRows).toHaveCount(3)
    await expect(page.getByText(/共 3 条解/)).toBeVisible()

    await page.locator('#factor-include').fill('4')
    await expect(resultRows).toHaveCount(2)
    await expect(page.getByText(/共 2 条解/)).toBeVisible()

    await page.locator('#factor-include').fill('')
    await expect(resultRows).toHaveCount(3)

    await page.locator('#factor-target').fill('1.25')
    await page.getByLabel('因子 1 的数值').fill('2.5')
    await page.getByLabel('因子 1 的最大数量').fill('1')
    await page
      .getByLabel('因子 1 的数值')
      .locator('..')
      .locator('input[type="checkbox"]')
      .check()
    await page.getByLabel('因子 2 的数值').fill('')
    await calculateButton.click()

    await expect(page.getByText('2.5×0.5(=1.25)', { exact: true }).first()).toBeVisible()
  })

  test('税额计算准确且配置刷新后仍然保留', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.locator('#factor-tax-total').fill('597140')
    await page.locator('#factor-tax-rate').fill('13')
    await page.getByRole('button', { name: '计算税额和不含税金额' }).click()

    await expect(page.getByText('528,442.48', { exact: true })).toBeVisible()
    await expect(page.getByText(/伍拾贰万捌仟肆佰肆拾贰元肆角捌分/)).toBeVisible()

    await page.locator('#factor-tax-rate').fill('-100')
    await page.getByRole('button', { name: '计算税额和不含税金额' }).click()
    await expect(page.getByRole('alert')).toHaveText('请输入有效的含税金额和税率')

    await page.locator('#factor-target').fill('12.34')
    await page.getByLabel('因子 1 的数值').fill('3.21')
    await expect.poll(async () => page.evaluate(() => localStorage.getItem('sum-solver-state')))
      .toContain('12.34')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('#factor-target')).toHaveValue('12.34')
    await expect(page.getByLabel('因子 1 的数值')).toHaveValue('3.21')
    expect(pageErrors, '因子工作台不应产生客户端运行时错误').toEqual([])
  })

  test('超长税额金额与人民币大写保持稳定对齐', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('#factor-tax-total').fill('999999999999.99')
    await page.locator('#factor-tax-rate').fill('13')
    await page.getByRole('button', { name: '计算税额和不含税金额' }).click()

    const resultItems = page.getByTestId('tax-result-item')
    await expect(resultItems).toHaveCount(3)

    const itemMetrics = await resultItems.evaluateAll(items => items.map((item) => {
      const uppercase = item.querySelector<HTMLElement>('[data-testid="tax-uppercase"]')
      const itemRect = item.getBoundingClientRect()
      const uppercaseRect = uppercase?.getBoundingClientRect()
      return {
        hasOverflow: item.scrollWidth > item.clientWidth,
        height: itemRect.height,
        uppercaseY: uppercaseRect?.y ?? null,
      }
    }))

    expect(itemMetrics.every(metric => !metric.hasOverflow)).toBe(true)
    expect(Math.max(...itemMetrics.map(metric => metric.height)) - Math.min(...itemMetrics.map(metric => metric.height))).toBeLessThanOrEqual(1)
    expect(new Set(itemMetrics.map(metric => metric.uppercaseY)).size).toBe(1)
  })

  test('大量组合仅在结果区滚动且工作台不超出可视高度', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '添加因子' }).click()
    await page.getByLabel('因子 3 的数值').fill('1')
    await page.locator('#factor-target').fill('100')
    await page.locator('#factor-max-results').fill('500')
    await page.getByTestId('factor-calculate').click()

    const resultRows = page.locator('[data-testid="factor-workbench"] tbody tr')
    await expect(resultRows).toHaveCount(276)

    const metrics = await page.evaluate(() => {
      const workbench = document.querySelector<HTMLElement>('[data-testid="factor-workbench"]')
      const resultScroller = document.querySelector<HTMLElement>('[data-testid="factor-results-scroll"]')
      const workbenchRect = workbench?.getBoundingClientRect()
      return {
        workbenchBottom: workbenchRect?.bottom ?? Number.POSITIVE_INFINITY,
        viewportHeight: window.innerHeight,
        resultClientHeight: resultScroller?.clientHeight ?? Number.POSITIVE_INFINITY,
        resultScrollHeight: resultScroller?.scrollHeight ?? 0,
        resultOverflowY: resultScroller ? getComputedStyle(resultScroller).overflowY : '',
      }
    })

    expect(metrics.workbenchBottom).toBeLessThanOrEqual(metrics.viewportHeight)
    expect(metrics.resultClientHeight).toBeLessThan(metrics.resultScrollHeight)
    expect(metrics.resultOverflowY).toBe('auto')
  })
})
