import { expect, test } from '@playwright/test'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ actionTimeout: 15_000 })

test('旧详情恢复失败后，五档业务列表和直接链接均可主动重新打开', async ({ page }) => {
  test.setTimeout(120_000)
  const name = '页签恢复重开样例'
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/finance/payment/new')
  await page.getByRole('button', { name: '公司付款', exact: true }).click()
  await page.getByTestId('finance-name').fill(name)
  await page.getByTestId('finance-amount').fill('100')
  await page.getByRole('spinbutton', { name: '本期批复金额', exact: true }).fill('0')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '返回付款申请', exact: true }).click()

  const row = page.locator('[data-ui="kit-table"]').getByRole('button', { name: new RegExp(`^${name}(?:\\s|$)`) }).first()
  await row.click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const detailPath = new URL(page.url()).pathname
  const tab = page.locator(`[data-tab-key="${detailPath}"]`)

  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.getByRole('link', { name: '返回付款申请', exact: true }).click()
    await expect(page).toHaveURL(/\/finance\/payment$/)
    await page.reload()
    await page.setViewportSize({ width, height: 900 })
    await tab.locator('[data-tab-trigger]').click()
    await expect(page.locator('[data-tab-restore-status] [role="alert"]')).toContainText('该详情的只读恢复尚未接入')
    await expect(page).toHaveURL(/\/finance\/payment$/)
    await expectNoPageOverflow(page, `恢复失败提示 ${width}`)
    await row.scrollIntoViewIfNeeded()
    await row.focus()
    await expect(row).toBeFocused()
    await row.press('Enter')
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '本期批复金额', exact: true })).toContainText('¥0.00')
    await expect(page.locator('[data-tab-restore-status] [role="alert"]')).toHaveCount(0)
    await expect(tab).toHaveCount(1)
    await expect(tab.locator('[data-tab-trigger]')).toHaveAttribute('aria-current', 'page')
    await expectNoPageOverflow(page, `列表重新打开 ${width}`)
  }

  await page.getByRole('link', { name: '返回付款申请', exact: true }).click()
  await page.reload()
  await page.goto(detailPath)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.locator('[data-tab-restore-status] [role="alert"]')).toHaveCount(0)
  expect(errors).toEqual([])
})
