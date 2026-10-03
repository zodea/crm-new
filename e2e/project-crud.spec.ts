import { expect, test } from '@playwright/test'

// #293 新增/编辑与 #423 导入均使用中央命令；本套开发实例删除仍禁用。

test('项目列表：正式新增与中央导入可用', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  const create = page.getByRole('button', { name: '新增项目', exact: true }).first()
  await expect(create).toBeVisible({ timeout: 15_000 })

  await expect(create).toBeEnabled()
  await expect(create).toHaveAttribute('title', '新增正式项目')
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toBeEnabled()
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toHaveAttribute('title', '导入项目（映射页签）')

  expect(pageErrors, '中央项目列表不应产生客户端运行错误').toEqual([])
})
