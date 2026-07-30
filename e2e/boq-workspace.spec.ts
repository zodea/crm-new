import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

function boqWorkbook(includeUnitPrice = true): Buffer {
  const workbook = XLSX.utils.book_new()
  const header = ['分部', '工种', '分项编码', '分项名称', '单位', '工程量']
  const row: (string | number)[] = ['机电安装', '水暖工', 'PLUMB-PIPE', '给排水管安装', 'm', 43]
  if (includeUnitPrice) {
    header.push('不含税单价')
    row.push(36)
  }
  header.push('户型', '房间')
  row.push('A', '整户范围')
  const sheet = XLSX.utils.aoa_to_sheet([
    ['合和新城户内装修清单'],
    header,
    row,
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
    await expect(page.getByTestId('boq-contract-number')).toHaveText('RJ-HHXC-SG-2025001')
    await expect(page.getByTestId('boq-contract-number')).toHaveAttribute('title', 'RJ-HHXC-SG-2025001')
    await expect(page.getByRole('link', { name: '合和新城施工总承包合同' })).toBeVisible()
    const amountValues = page.locator('.boq-summary-strip dd')
    await expect(amountValues).toHaveCount(4)
    for (const amount of await amountValues.all())
      expect(await amount.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const wallRow = page.getByRole('row').filter({ hasText: '墙砖铺贴' }).first()
    await expect(wallRow).toBeVisible()
    await expect(page.getByText('(原 26)', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: /变更单/ }).click()
    await expect(page.getByRole('link', { name: 'BG-2026-001', exact: true }))
      .toHaveAttribute('href', '/owner/change/boq_change_demo_001')
    await expect(page.getByText('已签证', { exact: true }).last()).toBeVisible()

    await page.getByRole('tab', { name: /月度报量/ }).click()
    await expect(page.getByRole('button', { name: /2026-06/ })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '地砖铺贴' })).toBeVisible()
    await expect(page.getByText('62', { exact: true }).first()).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
    expect(pageErrors).toEqual([])
  })

  test('键盘可在三个工作台标签间移动，并保持直接业务入口可聚焦', async ({ page }) => {
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    const linesTab = page.getByRole('tab', { name: /合同清单/ })
    await linesTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /变更单/ })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('link', { name: 'BG-2026-001', exact: true })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /月度报量/ })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('link', { name: '打开甲方报量单' })).toBeVisible()
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

  test('导入映射缺少必填列时保留错误状态并指出需修复字段', async ({ page }) => {
    await page.goto('/contract/boq/import?project=proj_demo_001&contract=con_demo_sg01')
    await page.waitForLoadState('networkidle')

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: '缺少合同单价.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: boqWorkbook(false),
    })

    await page.getByRole('button', { name: '下一步：人工确认', exact: true }).click()
    await page.getByRole('button', { name: '下一步：结果预览', exact: true }).click()
    const error = page.getByTestId('boq-mapping-error')
    await expect(error).toContainText('合同单价')
    await expect(error).toContainText('请选择来源列后再预览')
    await expect(page.getByText('必填未映射', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '人工确认列映射' })).toBeVisible()

    await page.getByRole('combobox', { name: '房间 / 部位' }).click()
    await page.getByRole('option', { name: '不导入', exact: true }).click()
    await expect(error).toContainText('合同单价')
    await expect(error).toContainText('请选择来源列后再预览')
  })

  test('清单行通过稳定引用进入现场算式与排程楼层计划', async ({ page }) => {
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /现场算式：墙砖铺贴/ }).first().click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\?.*boqLine=/)
    await expect(page.getByText('来自合同工程量清单', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '户型模板与三量' })).toBeVisible()
    await expect(page.getByRole('button', { name: '保存模板', exact: true })).toBeVisible()

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
      const changeTable = page.locator('.boq-change-table')
      const changeActionHeader = changeTable.getByRole('columnheader', { name: '操作', exact: true }).last()
      await expect(changeActionHeader).toBeVisible()
      expect((await changeActionHeader.boundingBox())?.width).toBeLessThanOrEqual(58)
      await expect(changeActionHeader.locator('.vxe-cell--col-resizable')).toHaveCount(0)
      await expect(changeTable.getByRole('button', { name: /变更单操作/ }).last()).toBeVisible()
      await page.getByRole('tab', { name: /月度报量/ }).click()
      await expect(page.getByText('自动汇总 + 手调留痕', { exact: true })).toBeVisible()
      await expectDocumentDoesNotOverflow(page)

      await page.goto('/contract/boq/import?project=proj_demo_001&contract=con_demo_sg01')
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: '合同清单拆表' })).toBeVisible()
      await expectDocumentDoesNotOverflow(page)
    })
  }
})
