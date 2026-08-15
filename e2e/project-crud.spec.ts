import { expect, test } from '@playwright/test'

// #293 将正式项目新增/编辑切换为中央命令；导入与删除仍不在当前范围。

test('项目列表：中央新增可用，未迁移的导入仍禁用', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  const create = page.getByRole('button', { name: '新增项目', exact: true }).first()
  await expect(create).toBeVisible({ timeout: 15_000 })

  await expect(create).toBeEnabled()
  await expect(create).toHaveAttribute('title', '新增正式项目')
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toBeDisabled()
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toHaveAttribute('title', '项目导入尚未接入中央后台')

  expect(pageErrors, '中央项目列表不应产生客户端运行错误').toEqual([])
})
