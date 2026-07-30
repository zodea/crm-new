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

test('材料采购合同列表复刻单层分类与紧凑省略号操作', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/contract/material')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('材料采购合同分类', { exact: true })).toBeVisible()
  await expect(page.getByText('全部材料采购合同', { exact: true })).toBeVisible()
  const toolbar = page.locator('[data-ui="contract-list-toolbar"]')
  await expect(toolbar.getByRole('combobox', { name: '状态' })).toBeVisible()
  await expect(page.locator('[data-ui="contract-list-toolbar"] + .panel')).toHaveCount(0)
  const rowMenu = page.locator('[data-ui="row-action-menu-trigger"]').first()
  await expect(rowMenu).toBeVisible()
  const targetLabel = await rowMenu.getAttribute('aria-label')
  const targetName = targetLabel?.replace(/合同操作$/, '') ?? ''
  const mainRows = page.locator('.vxe-table--main-wrapper .vxe-body--row')
  const rowCount = await mainRows.count()
  await rowMenu.focus()
  await rowMenu.press('Enter')
  const menu = page.getByRole('menu').first()
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: '删除' }).click()
  const confirm = page.getByRole('dialog', { name: /删除材料采购合同/ })
  await expect(confirm).toBeVisible()
  await expect(page.locator('a').filter({ hasText: targetName }).first()).toBeVisible()
  await expect(mainRows).toHaveCount(rowCount)
  await confirm.getByRole('button', { name: '取消' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('link', { name: targetName, exact: true }).first()).toBeVisible()
  await expect(mainRows).toHaveCount(rowCount)
  await expect(rowMenu).toBeFocused()
  await expectNoPageOverflow(page, '材料采购合同列表')
  await expectLocalHorizontalScroll(
    page.locator('.vxe-table--scroll-x-handle').first(),
    '材料采购合同表格',
  )
})

for (const width of RESPONSIVE_WIDTHS) {
  test(`材料采购合同工具栏在 ${width}px 不隐藏状态与新增操作`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/contract/material')
    await page.waitForLoadState('networkidle')

    const toolbar = page.locator('[data-ui="contract-list-toolbar"]')
    await expect(toolbar.getByRole('combobox', { name: '状态' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '新增材料采购合同' })).toBeVisible()
    await expectNoPageOverflow(page, `${width}px 材料采购合同列表`)
  })
}
