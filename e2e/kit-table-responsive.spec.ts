import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function expectColumnWidthsAligned(table: Locator) {
  await expect.poll(() => table.evaluate((root) => {
    const differences: number[] = []
    for (const region of root.querySelectorAll('.vxe-table--main-wrapper, .vxe-table--fixed-left-wrapper, .vxe-table--fixed-right-wrapper')) {
      if (!region.getBoundingClientRect().width)
        continue
      const row = region.querySelector('.vxe-body--row')
      for (const head of region.querySelectorAll('.vxe-header--column[colid]:not(.fixed--hidden)')) {
        const width = head.getBoundingClientRect().width
        if (!width)
          continue
        const body = row?.querySelector(`.vxe-body--column[colid="${CSS.escape(head.getAttribute('colid')!)}"]`)
        if (!body)
          return Number.POSITIVE_INFINITY
        differences.push(Math.abs(width - body.getBoundingClientRect().width))
      }
    }
    return differences.length ? Math.max(...differences) : Number.POSITIVE_INFINITY
  }), '同一列的表头和正文宽度差不超过 1.5px').toBeLessThanOrEqual(1.5)
}

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
    await expect(handle).toHaveCSS('cursor', 'col-resize')
    const headerBounds = (await header.boundingBox())!
    const handleBounds = (await handle.boundingBox())!
    const rightEdge = headerBounds.x + headerBounds.width
    expect(handleBounds.width).toBeGreaterThan(0)
    expect(handleBounds.width).toBeLessThanOrEqual(12)
    expect(handleBounds.x).toBeLessThan(rightEdge)
    expect(handleBounds.x + handleBounds.width).toBeGreaterThanOrEqual(rightEdge)

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
    await expectColumnWidthsAligned(table)
  })

  // 当前施工合同专属列表不再提供旧本地操作列；通用编辑/删除项目由 RowActionMenu.test.ts 验证。
  test('分供方只读列表用紧凑省略号菜单收纳当前可用动作', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
    await page.goto('/base/supplier?search=穗建五金')
    await page.waitForLoadState('networkidle')

    const actionColumn = page.locator('[data-ui="kit-table"] .vxe-table--fixed-right-wrapper').first()
    await expect(actionColumn).toBeVisible()
    const width = (await actionColumn.boundingBox())!.width
    expect(width).toBeGreaterThanOrEqual(32)
    expect(width).toBeLessThanOrEqual(114)
    const trigger = actionColumn.locator('[data-ui="row-action-menu-trigger"]').first()
    await expect(trigger).toBeVisible()
    const actionLabel = await trigger.getAttribute('aria-label')
    expect(actionLabel).toBeTruthy()
    const initialUrl = page.url()
    await trigger.focus()
    await trigger.press('Enter')
    const menu = page.getByRole('menu', { name: actionLabel! })
    await expect(menu.getByRole('menuitem', { name: '查看详情' })).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['查看详情'])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(page.url()).toBe(initialUrl)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(actionColumn.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    await expectColumnWidthsAligned(page.locator('[data-ui="kit-table"]').first())
    await expectDocumentDoesNotOverflow(page)
  })

  test('宽表在各宽度只在自身容器横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    const vxeTable = table.locator('.vxe-table').first()
    const scrollX = table.locator('.vxe-table--scroll-x-wrapper').first()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 900 },
      { width: 1440, height: 1000 },
    ] as const) {
      await page.setViewportSize(viewport)
      await expect(scrollX).toBeVisible()
      await expect.poll(async () => {
        const [tableBox, scrollBox] = await Promise.all([vxeTable.boundingBox(), scrollX.boundingBox()])
        return scrollBox!.x >= tableBox!.x && scrollBox!.x + scrollBox!.width <= tableBox!.x + tableBox!.width + 1
      }, `${viewport.width}px 横滚条应位于表格容器内`).toBe(true)
      await expectColumnWidthsAligned(table)
      await expectDocumentDoesNotOverflow(page)
    }
  })
})
