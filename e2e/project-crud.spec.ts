import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

// 项目列表增删撤回旅程（#58）。复用现有页签基建与共享 store：
// seed/projects.json 提供演示数据（proj_demo_001 = 合和新城）。

async function selectCustomer(page: Page, name: string) {
  const lookup = page.getByRole('combobox', { name: '检索客户' })
  await lookup.fill(name)
  await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible()
  await page.getByRole('option', { name: new RegExp(name) }).click()
}

test('项目列表：新增 → 软删 → 10 秒内撤回恢复', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project')
  await expect(page.getByRole('link', { name: '合和新城' })).toBeVisible()

  // 新增：整页表单填完提交必填项，lookup 保存真实 customer_id。
  await page.getByRole('button', { name: '新增项目' }).click()
  await expect(page).toHaveURL('/project/form')
  await expect(page.getByRole('heading', { name: '新建 · 项目' })).toBeVisible()
  await page.getByLabel('项目名称 *').fill('E2E临时项目')
  await selectCustomer(page, '合和地产')
  await page.getByLabel('项目经理 *').fill('E2E经理')
  await page.getByRole('group', { name: '表单操作' })
    .getByRole('button', { name: '保存', exact: true })
    .click()
  await expect(page).toHaveURL('/project')
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
