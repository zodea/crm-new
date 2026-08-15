import { expect, test } from '@playwright/test'

// #288 将项目列表切换为中央后台权威读链。写命令尚未迁移前，列表必须明确
// 保持只读，不能让旧的本地 SQLite CRUD 看起来像已写入中央后台。

test('项目列表：中央读链期间明确禁用新增、导入、编辑与删除', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  await expect(page.getByRole('link', { name: '合和新城', exact: true }).first())
    .toBeVisible({ timeout: 15_000 })

  const reason = '项目写入尚未接入中央后台'
  await expect(page.getByRole('button', { name: '新增项目', exact: true }))
    .toBeDisabled()
  await expect(page.getByRole('button', { name: '新增项目', exact: true }))
    .toHaveAttribute('title', reason)
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toBeDisabled()
  await expect(page.getByRole('button', { name: '导入项目', exact: true }))
    .toHaveAttribute('title', reason)
  await expect(page.getByRole('button', { name: '编辑项目', exact: true }).first())
    .toBeDisabled()
  await expect(page.getByRole('button', { name: '删除项目', exact: true }).first())
    .toBeDisabled()

  expect(pageErrors, '中央只读项目列表不应产生客户端运行错误').toEqual([])
})
