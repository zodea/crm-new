import { expect, test } from '@playwright/test'

// 项目列表增删撤回旅程（#58）。复用现有页签基建与共享 store：
// seed/projects.json 提供演示数据（proj_demo_001 = 合和新城）。

const NAME_PLACEHOLDER = '如：合和新城·3号楼'

test('项目列表：新增 → 软删 → 10 秒内撤回恢复', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('link', { name: '合和新城' })).toBeVisible()

  // 新增：填必填项目名 → 保存后新行出现在列表（created_at DESC，置顶）。
  await page.getByRole('button', { name: '新增项目' }).click()
  const formDialog = page.getByRole('dialog')
  await formDialog.getByPlaceholder(NAME_PLACEHOLDER).fill('E2E临时项目')
  await formDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('link', { name: 'E2E临时项目' })).toBeVisible()

  // 删除：新项目无下游 → simple 确认弹窗（非 cascade）。
  await page.getByRole('button', { name: '删除项目' }).first().click()
  const confirmDialog = page.getByRole('dialog')
  await expect(confirmDialog).toContainText('确认删除项目「E2E临时项目」')
  await confirmDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByRole('link', { name: 'E2E临时项目' })).toHaveCount(0)

  // 撤回：undoToast 的「撤回」动作恢复原行。
  await expect(page.getByText('已删除「E2E临时项目」', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤回' }).click()
  await expect(page.getByRole('link', { name: 'E2E临时项目' })).toBeVisible()

  expect(pageErrors, '增删撤回旅程不应产生客户端运行错误').toEqual([])
})
