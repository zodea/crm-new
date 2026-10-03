import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectInViewport, expectNoPageOverflow } from './helpers/responsive'

// 档案目录、敏感资料权限、真实 ZIP 与取消写盘的正向覆盖保留在
// tests/project/archive.test.ts、tests/components/ProjectArchiveExportDialog.test.ts。
// 当前中央详情没有接管本地档案包快照，因此不要求不可达的 ZIP 对话框。
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
] as const

for (const [index, viewport] of VIEWPORTS.entries()) {
  test(`${viewport.width}px 中央项目基础资料完整可读，未接管档案导出保持关闭`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const fixture = await installProjectCentralFixture(page, PROJECT_INPUTS[index % PROJECT_INPUTS.length])
    await fixture.open()
    const readonly = page.getByRole('status', { name: '中央项目只读详情', exact: true })
    await expect(readonly.getByRole('group', { name: '基础信息' })).toContainText(fixture.input.address)
    await expect(readonly.getByRole('group', { name: '参建单位' })).toContainText(fixture.input.manager)
    await expect(readonly.getByRole('group', { name: '系统信息' })).toBeVisible()
    await expect(page.getByRole('button', { name: '导出项目档案包', exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: /导出项目档案包/ })).toHaveCount(0)
    const edit = page.getByRole('link', { name: '编辑项目', exact: true })
    await expectInViewport(edit, `${viewport.width}px 正式整页编辑入口`)
    await expectNoPageOverflow(page, `${viewport.width}px 中央项目基础资料`)
    expect(fixture.errors).toEqual([])
  })
}
