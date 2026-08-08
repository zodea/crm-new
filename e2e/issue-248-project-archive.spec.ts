import { expect, test } from '@playwright/test'
import { expectInViewport, expectNoPageOverflow } from './helpers/responsive'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
] as const

test.describe('Issue #248：项目详情阶段重排与档案包导出', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px 详情页可进入档案包导出并保持局部滚动边界`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/project/proj_demo_001')
      await expect(page.getByRole('heading', { name: '合和新城', exact: true })).toBeVisible({ timeout: 20_000 })

      const modules = page.locator('[data-project-module]')
      await expect(modules.first()).toHaveAttribute('data-project-module', 'timeline')
      await expectInViewport(
        page.getByRole('button', { name: '导出项目档案包', exact: true }),
        `${viewport.width}px 档案包入口`,
      )

      const trigger = page.getByRole('button', { name: '导出项目档案包', exact: true })
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: /导出项目档案包 · 选择范围/ })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('tree', { name: '项目档案导出范围' })).toBeVisible()
      await expect(dialog.getByText(/敏感资料：默认排除/)).toBeVisible()
      await expect(dialog.getByRole('button', { name: '开始导出 ZIP' })).toBeVisible()
      await expectNoPageOverflow(page, `${viewport.width}px 项目档案导出对话框`)
    })
  }
})
