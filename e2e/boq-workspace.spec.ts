import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

function boqWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['合和新城户内装修清单'],
    ['分部', '工种', '分项编码', '分项名称', '单位', '工程量', '不含税单价', '户型', '房间'],
    ['机电安装', '水暖工', 'PLUMB-PIPE', '给排水管安装', 'm', 43, 36, 'A', '整户范围'],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, '户内安装')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #115：BOQ 清单、变更与月度报量', () => {
  test('真实 seed 在一个工作区展示有效合同值、签证台账与月报量', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/contract/boq')
    await expect(page.getByRole('heading', { name: '合同工程量清单' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
    const wallRow = page.getByRole('row').filter({ hasText: '墙砖铺贴' }).first()
    await expect(wallRow).toBeVisible()
    await expect(page.getByText('(原 26)', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: /变更单/ }).click()
    await expect(page.getByRole('cell', { name: 'BG-2026-001' })).toBeVisible()
    await expect(page.getByText('已签证', { exact: true }).last()).toBeVisible()

    await page.getByRole('tab', { name: /月度报量/ }).click()
    await expect(page.getByRole('button', { name: /2026-06/ })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '地砖铺贴' })).toBeVisible()
    await expect(page.getByText('62', { exact: true }).first()).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
    expect(pageErrors).toEqual([])
  })

  test('三步拆表向导识别表头、预览并把新行回接户型工程量', async ({ page }) => {
    await page.goto('/contract/boq/import?project=proj_demo_001&contract=con_demo_sg01')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '合同清单拆表' })).toBeVisible()

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: '新增施工清单.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: boqWorkbook(),
    })

    await expect(page.getByText('已识别 A 类', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一步：人工确认', exact: true }).click()
    await expect(page.getByRole('heading', { name: '人工确认列映射' })).toBeVisible()
    await page.getByRole('button', { name: '下一步：结果预览', exact: true }).click()
    await expect(page.getByRole('heading', { name: '拆表结果预览' })).toBeVisible()
    const quantityInput = page.getByLabel('单套量 给排水管安装')
    await expect(quantityInput).toHaveValue('43')
    await quantityInput.fill('44')
    await page.getByRole('button', { name: '确认导入 1 行', exact: true }).click()

    await expect(page).toHaveURL(/\/contract\/boq\?/)
    await expect(page.getByText('已导入 1 行，1 行已回接户型工程量', { exact: true })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '新增施工清单.xlsx·户内安装·3' })).toContainText('44')
  })

  test('清单行通过稳定引用进入现场算式与排程楼层计划', async ({ page }) => {
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /现场算式：墙砖铺贴/ }).first().click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\?.*boqLine=/)
    await expect(page.getByText('来自合同工程量清单', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '户型模板与三量' })).toBeVisible()

    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /楼层计划：墙砖铺贴/ }).first().click()
    await expect(page).toHaveURL(/\/schedule\?.*boqLine=/)
    const dialog = page.getByRole('dialog', { name: /工序详情 · 墙砖粘贴/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('分项 × 楼层计划', { exact: true })).toBeVisible()
    await expect(dialog.getByText(/1栋 · 1层/).first()).toBeVisible()
  })

  test('清单页头部保持紧凑，固定操作列不挤占页面且横滚留在表格内', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    const header = page.getByTestId('boq-workspace-header')
    await expect(header).toBeVisible()
    expect((await header.boundingBox())?.height).toBeLessThanOrEqual(190)

    const fixedActions = page.locator('.boq-lines-layout .vxe-table--fixed-right-wrapper').first()
    await expect(fixedActions).toBeVisible()
    expect((await fixedActions.boundingBox())?.width).toBeLessThanOrEqual(160)

    const tablePanel = page.locator('.boq-lines-layout .vxe-table').first()
    const horizontalScroller = page.locator('.boq-lines-layout .vxe-table--scroll-x-wrapper').first()
    await expect(horizontalScroller).toBeVisible()
    const tableBox = await tablePanel.boundingBox()
    const scrollerBox = await horizontalScroller.boundingBox()
    expect(scrollerBox!.x).toBeGreaterThanOrEqual(tableBox!.x)
    expect(scrollerBox!.x + scrollerBox!.width).toBeLessThanOrEqual(tableBox!.x + tableBox!.width + 1)
    await expectDocumentDoesNotOverflow(page)
  })

  test('清单列只从右缘拖拽，双击手柄恢复自适应且固定操作列不位移', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    const unitTypeHeader = page.locator('.boq-lines-table .vxe-header--column')
      .filter({ hasText: '户型' })
      .first()
    const handle = unitTypeHeader.locator('.vxe-cell--col-resizable')
    await handle.scrollIntoViewIfNeeded()
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

    const actionFixed = page.locator('.boq-lines-table .vxe-table--fixed-right-wrapper')
    const actionWidthBefore = (await actionFixed.boundingBox())!.width
    await expect(actionFixed.locator('.vxe-cell--col-resizable')).toHaveCount(0)

    const widthBefore = (await unitTypeHeader.boundingBox())!.width
    const handleBox = (await handle.boundingBox())!
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 70, handleBox.y + handleBox.height / 2)
    await page.mouse.up()
    expect((await unitTypeHeader.boundingBox())!.width).toBeGreaterThan(widthBefore + 40)

    await handle.dblclick()
    expect((await unitTypeHeader.boundingBox())!.width).toBeLessThan(widthBefore + 10)
    expect((await actionFixed.boundingBox())!.width).toBe(actionWidthBefore)
    await expectDocumentDoesNotOverflow(page)
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 清单/变更/报量全部可达且页面不横滚`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/contract/boq')
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('tab', { name: /合同清单/ })).toBeVisible()
      await page.getByRole('tab', { name: /变更单/ }).click()
      await expect(page.getByRole('button', { name: '新建变更单', exact: true })).toBeVisible()
      await page.getByRole('tab', { name: /月度报量/ }).click()
      await expect(page.getByText('自动汇总 + 手调留痕', { exact: true })).toBeVisible()
      await expectDocumentDoesNotOverflow(page)
    })
  }
})
