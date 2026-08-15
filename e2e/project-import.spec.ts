import { expect, test } from '@playwright/test'

// #288 的边界是中央后台只读项目列表；旧映射页仍可由历史直达路由访问，
// 但列表不能在中央写命令落地前继续把本地导入暴露为有效动作。

test('项目导入：中央写命令未接入时不从项目列表进入本地映射流程', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  await expect(page.getByText('共 12 个')).toBeVisible({ timeout: 15_000 })

  const importButton = page.getByRole('button', { name: '导入项目', exact: true })
  await expect(importButton).toBeDisabled()
  await expect(importButton).toHaveAttribute('title', '项目写入尚未接入中央后台')
  await expect(page).toHaveURL(/\/project$/)

  expect(pageErrors, '只读边界不应产生客户端运行错误').toEqual([])
})
