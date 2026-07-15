import { expect, test } from '@playwright/test'

test('项目六阶段：编辑任务后持久化并实时更新阶段卡进度', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/proj_demo_001')
  await page.waitForLoadState('networkidle')

  const timeline = page.locator('section[aria-labelledby="project-phase-title"]')
  for (const name of ['项目立项', '施工准备', '施工中', '完工及验收', '交付', '保修'])
    await expect(timeline.getByRole('button').filter({ hasText: name })).toHaveCount(1)
  await expect(timeline.getByRole('button').filter({ hasText: '施工准备' })).toContainText('2/5')

  await timeline.getByRole('button', { name: '编辑阶段', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑阶段任务 · 全部六阶段' })
  const taskCard = dialog.locator('[data-phase-task-id="phase_demo_004"]')
  const titleInput = taskCard.locator('input').first()
  await expect(titleInput).toHaveValue('材料定样板')
  await titleInput.fill('材料定样板（已核）')
  await taskCard.locator('select').selectOption('confirmed')
  await dialog.getByRole('button', { name: '保存阶段任务' }).click()

  await expect(page.getByText('阶段任务已更新', { exact: true })).toBeVisible()
  await expect(timeline.getByRole('button').filter({ hasText: '施工准备' })).toContainText('3/5')

  // 重新打开编辑器，确认 action 重载后的 DB 值回填，而非只改了组件局部草稿。
  await timeline.getByRole('button', { name: '编辑阶段', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '编辑阶段任务 · 全部六阶段' })
    .locator('[data-phase-task-id="phase_demo_004"] input').first()).toHaveValue('材料定样板（已核）')

  expect(pageErrors, '阶段编辑旅程不应产生客户端运行错误').toEqual([])
})
