import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'

// 阶段文件的持久化正文、同一 file_refs、软删及撤回正向覆盖：
// tests/project/phase-task-files.test.ts、tests/stores/phase-task.test.ts。
// 当前中央项目尚未接管本地阶段文件柜，浏览与刷新不能暴露本地上传路径。
for (const input of PROJECT_INPUTS) {
  test(`${input.label}：刷新中央基础资料保留正式身份，不暴露本地阶段文件写入口`, async ({ page }) => {
    const fixture = await installProjectCentralFixture(page, input)
    await fixture.open()
    await page.reload()

    const detail = page.getByRole('status', { name: '中央项目只读详情', exact: true })
    await expect(detail.getByRole('group', { name: '基础信息' })).toContainText(input.address)
    await expect(detail.getByRole('group', { name: '参建单位' })).toContainText(input.manager)
    await expect(page).toHaveURL(fixture.url)
    await expect(page.getByRole('region', { name: '项目文件柜' })).toHaveCount(0)
    await expect(page.getByLabel(/上传.*阶段|上传施工组织设计方案文件/)).toHaveCount(0)
    await expect(detail.locator('input[type="file"]')).toHaveCount(0)
    expect(fixture.errors).toEqual([])
  })
}
