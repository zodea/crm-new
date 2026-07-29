import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

for (const width of RESPONSIVE_WIDTHS) {
  test(`分包合同工具栏在 ${width}px 保持稳定且仅表格内部横滚`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/contract/subcontract')
    await page.waitForLoadState('networkidle')

    const toolbar = page.locator('[data-ui="contract-list-toolbar"]')
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('heading', { name: '分包合同' })).toBeVisible()
    await expect(toolbar.getByText(/共\s*\d+\s*份/)).toHaveCount(0)
    await expect(toolbar.getByText(/当前\s*\d+\s*份/)).toHaveCount(0)
    await expect(toolbar.getByRole('combobox', { name: '项目' })).toBeVisible()
    await expect(toolbar.getByRole('searchbox', { name: '搜索合同名称 / 编号' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '刷新' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '新增分包合同' })).toBeVisible()

    const titleBox = await toolbar.getByRole('heading', { name: '分包合同' }).boundingBox()
    const projectBox = await toolbar.getByRole('combobox', { name: '项目' }).boundingBox()
    const search = toolbar.getByRole('searchbox', { name: '搜索合同名称 / 编号' })
    const searchBox = await search.boundingBox()
    const createBox = await toolbar.getByRole('button', { name: '新增分包合同' }).boundingBox()
    expect(titleBox).not.toBeNull()
    expect(projectBox).not.toBeNull()
    expect(searchBox).not.toBeNull()
    expect(createBox).not.toBeNull()

    if (width >= 768) {
      expect(Math.abs(titleBox!.y - projectBox!.y)).toBeLessThanOrEqual(8)
      expect(Math.abs(projectBox!.y - searchBox!.y)).toBeLessThanOrEqual(8)
      expect(Math.abs(searchBox!.y - createBox!.y)).toBeLessThanOrEqual(8)
    }
    else {
      expect(projectBox!.y).toBeGreaterThanOrEqual(titleBox!.y)
      expect(searchBox!.y).toBeGreaterThanOrEqual(projectBox!.y)
    }

    await expectNoPageOverflow(page, `${width}px 分包合同列表`)
    await expectLocalHorizontalScroll(
      page.locator('.vxe-table--scroll-x-handle').first(),
      `${width}px 分包合同表格`,
    )

    const toolbarHeight = (await toolbar.boundingBox())!.height
    await search.fill('不存在的合同')
    const filteredToolbarHeight = (await toolbar.boundingBox())!.height
    expect(Math.abs(filteredToolbarHeight - toolbarHeight)).toBeLessThanOrEqual(1)
  })
}
