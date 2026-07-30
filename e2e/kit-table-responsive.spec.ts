import { expect, test } from '@playwright/test'

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('KitTable 公共表格规格', () => {
  test('普通列仅从右缘拖拽，固定操作列没有含混手柄', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    await expect(table).toBeVisible()

    const header = table.locator('.vxe-header--column').filter({ hasText: '项目编号' }).first()
    const handle = header.locator('.vxe-cell--col-resizable')
    await expect(handle).toBeVisible()
    expect(await handle.evaluate(element => ({
      cursor: getComputedStyle(element).cursor,
      right: getComputedStyle(element).right,
      width: getComputedStyle(element).width,
    }))).toEqual({
      cursor: 'col-resize',
      right: '-4px',
      width: '7px',
    })

    const actionColumn = table.locator('.vxe-table--fixed-right-wrapper')
    await expect(actionColumn).toBeVisible()
    await expect(actionColumn.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    expect((await actionColumn.boundingBox())?.width).toBeLessThanOrEqual(114)

    const disabledHeader = table.locator('.vxe-header--column').filter({ hasText: '计划开工' }).first()
    await expect(disabledHeader.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    await expectDocumentDoesNotOverflow(page)
  })

  test('双击普通列表头手柄恢复自适应', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    const header = table.locator('.vxe-header--column').filter({ hasText: '项目编号' }).first()
    const handle = header.locator('.vxe-cell--col-resizable')
    const before = (await header.boundingBox())!.width
    const handleBox = (await handle.boundingBox())!
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 72, handleBox.y + handleBox.height / 2)
    await page.mouse.up()
    expect((await header.boundingBox())!.width).toBeGreaterThan(before + 40)

    await handle.dblclick()
    expect((await header.boundingBox())!.width).toBeLessThan(before + 10)
  })

  test('真实合同列表用紧凑省略号菜单收纳行操作且不留大块空白', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/contract/construction')
    await page.waitForLoadState('networkidle')

    const actionColumn = page.locator('[data-ui="kit-table"] .vxe-table--fixed-right-wrapper').first()
    await expect(actionColumn).toBeVisible()
    const width = (await actionColumn.boundingBox())!.width
    expect(width).toBeGreaterThanOrEqual(52)
    expect(width).toBeLessThanOrEqual(60)
    const trigger = actionColumn.locator('[data-ui="row-action-menu-trigger"]').first()
    await expect(trigger).toBeVisible()
    const actionLabel = await trigger.getAttribute('aria-label')
    expect(actionLabel).toBeTruthy()
    const initialUrl = page.url()
    await trigger.focus()
    await trigger.press('Enter')
    const menu = page.getByRole('menu', { name: actionLabel! })
    await expect(menu.getByRole('menuitem', { name: '查看详情' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '编辑' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '删除' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(page.url()).toBe(initialUrl)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(actionColumn.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    await expectDocumentDoesNotOverflow(page)
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 宽表只在自身容器横滚`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/dev/kit-table')
      await page.waitForLoadState('networkidle')

      const table = page.locator('[data-ui="kit-table"]').first()
      const vxeTable = table.locator('.vxe-table').first()
      const scrollX = table.locator('.vxe-table--scroll-x-wrapper').first()
      await expect(scrollX).toBeVisible()

      const tableBox = await vxeTable.boundingBox()
      const scrollBox = await scrollX.boundingBox()
      expect(scrollBox!.x).toBeGreaterThanOrEqual(tableBox!.x)
      expect(scrollBox!.x + scrollBox!.width).toBeLessThanOrEqual(tableBox!.x + tableBox!.width + 1)
      await expectDocumentDoesNotOverflow(page)
    })
  }
})
