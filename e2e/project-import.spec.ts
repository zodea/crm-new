import { expect, test } from '@playwright/test'

// #423 已接通中央保存，列表真实入口与历史深链共享中央边界。

test('项目导入：有中央写权限时从项目列表打开真实导入流程', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')

  const importButton = page.getByRole('button', { name: '导入项目', exact: true })
  await expect(importButton).toBeEnabled({ timeout: 15_000 })
  await importButton.click()
  await expect(page).toHaveURL(/\/import\/mapping\/project$/)
  await expect(page.getByRole('heading', { name: '导入项目', exact: true })).toBeVisible()

  expect(pageErrors, '导入入口不应产生客户端运行错误').toEqual([])
})
