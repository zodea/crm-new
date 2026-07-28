import { expect, test } from '@playwright/test'

test('成本预算按正式源单展示分类控制且不再使用占位卡', async ({ page }) => {
  await page.goto('/project/proj_demo_001')

  await page.getByRole('tab', { name: '成本预算', exact: true }).click()

  await expect(page.getByRole('region', { name: '目标成本版本' })).toBeVisible()
  const categories = page.getByRole('region', { name: '目标成本分类控制' })
  await expect(categories).toBeVisible()
  await expect(categories.getByText('合同劳务', { exact: true })).toBeVisible()
  await expect(categories.getByText('专业分包', { exact: true })).toBeVisible()
  await expect(categories.getByText('材料', { exact: true })).toBeVisible()
  await expect(categories.getByRole('link', { name: /合同/ }).first()).toHaveAttribute('href', /\/contract\//)
  await expect(page.getByText('待建设', { exact: true })).toHaveCount(0)
})
