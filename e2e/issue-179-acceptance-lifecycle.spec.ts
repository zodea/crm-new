import { expect, test } from '@playwright/test'

test('验收保修页签接入真实生命周期并移除占位卡', async ({ page }) => {
  await page.goto('/project/proj_demo_001')

  await page.getByRole('tab', { name: '竣工验收及保修', exact: true }).click()

  const lifecycle = page.getByRole('region', { name: '竣工验收与保修', exact: true })
  await expect(lifecycle).toBeVisible()
  await expect(
    lifecycle.getByText('当前项目尚无竣工验收或保修记录', { exact: true }).nth(1),
  ).toBeVisible()
  await expect(page.getByText('待建设', { exact: true })).toHaveCount(0)
})
