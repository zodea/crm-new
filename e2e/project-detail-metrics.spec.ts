import { expect, test } from '@playwright/test'

test('项目详情票据面板：归档新票后金额、税额与张数实时更新', async ({ page }) => {
  test.setTimeout(60_000)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: '合和新城', exact: true }).click()

  const invoicePanel = page.locator('section[aria-labelledby="project-invoice-title"]')
  await expect(invoicePanel.getByText('0 张归档票')).toBeVisible()
  await expect(invoicePanel.getByText('¥0.00')).toHaveCount(2)

  // 保持详情页签打开，经侧栏进入发票台账；共享 invoice store 的归档 action 应实时回推本页。
  await page.getByRole('link', { name: '发票台账', exact: true }).click()
  await page.getByRole('button', { name: /待归档/ }).click()

  // vxe fixed-right 操作列渲染在独立表格中，但行序与主表一致；目标票是待归档首行。
  await page.getByRole('button', { name: '归档', exact: true }).first().click()

  const dialog = page.getByRole('dialog', { name: '归档发票' })
  await dialog.locator('select').nth(0).selectOption({ label: '归属项目' })
  await dialog.locator('select').nth(1).selectOption({ label: '合和新城' })
  await dialog.getByRole('button', { name: '归档', exact: true }).click()
  await expect(page.getByText('已归档，计入台账', { exact: true })).toBeVisible()

  const tabBar = page.getByRole('navigation', { name: '已打开页面' })
  await tabBar.getByRole('button', { name: '合和新城', exact: true }).click()

  await expect(invoicePanel.getByText('1 张归档票')).toBeVisible()
  await expect(invoicePanel.getByText('¥40,000.88')).toBeVisible()
  await expect(invoicePanel.getByText('¥5,199.12')).toBeVisible()

  // 票税管理的收票登记与同一台账查询口径一致：归档后无需刷新即可出现该票。
  await page.getByRole('tab', { name: '票税管理', exact: true }).click()
  const receivedInvoices = page.getByRole('region', { name: '收票登记' })
  await expect(receivedInvoices.getByText('09442026000058761', { exact: true })).toBeVisible()
  await expect(receivedInvoices.getByText('¥45,200.00', { exact: true })).toBeVisible()
  expect(pageErrors, '归档联动旅程不应产生客户端运行错误').toEqual([])
})
