import { expect, test } from '@playwright/test'

test('支出合同页签按真实合同外键展示四组关系和来源入口', async ({ page }) => {
  await page.goto('/project/proj_demo_001')

  await page.getByRole('tab', { name: '支出合同管理', exact: true }).click()

  const contracts = page.getByRole('region', { name: '支出合同', exact: true })
  await expect(contracts).toBeVisible()
  await expect(contracts.getByRole('link', { name: '泥水班组劳务分包合同' })).toHaveAttribute(
    'href',
    '/contract/con_demo_fb01',
  )
  await expect(contracts.getByText('合同劳务', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '支出合同补充协议' })).toBeVisible()
  await expect(page.getByRole('region', { name: '分包变洽签' })).toBeVisible()
  await expect(page.getByRole('region', { name: '支出结算' })).toBeVisible()
  await expect(page.getByText('待建设', { exact: true })).toHaveCount(0)
})
