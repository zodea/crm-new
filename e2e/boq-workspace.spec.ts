import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { test as base, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import { seedProductionSnapshot } from './helpers/browser-production-snapshot'

const INPUT = {
  projectName: '受控清单工程',
  contractName: '受控施工合同',
  contractNumber: 'SG-BOQ-TEST',
  changeNumber: 'BG-BOQ-TEST',
  sourceMonth: '2026-06',
  generationMonth: '2026-04',
  wall: { name: '墙砖铺贴', quantity: 26, delta: 2, price: 260 },
  floor: { name: '地砖铺贴', quantity: 62, price: 80, amount: 4960 },
  pipe: { name: '给排水管安装', code: 'PLUMB-PIPE', quantity: 43, confirmed: 44, field: 42, price: 36, provisionalAmount: '¥1,584.00', fieldAmount: '¥1,512.00' },
  unitType: 'A',
  room: '整户范围',
  fileName: '新增施工清单.xlsx',
  sheetName: '户内安装',
}

interface BoqFixture { projectId: string, contractId: string, changeId: string, wallId: string, pageErrors: string[] }

// 每个浏览器上下文显式准备独立的迁移前正式来源，不依赖演示开关或前一条用例的写入。
const test = base.extend<{ boq: BoqFixture }>({
  boq: [async ({ page, baseURL }, use) => {
    const prefix = `boq-${randomUUID()}`
    const id = (kind: string) => `${prefix}-${kind}`
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.clock.setFixedTime(new Date('2026-07-02T00:00:00Z'))
    if (!baseURL)
      throw new Error('BOQ 夹具需要 Playwright baseURL')
    await seedProductionSnapshot(page, baseURL, (db) => {
      const insert = (table: string, row: Record<string, string | number | null>) => {
        const columns = Object.keys(row)
        db.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, Object.values(row))
      }
      insert('projects', { id: id('project'), name: INPUT.projectName })
      insert('contracts', { id: id('contract'), project_id: id('project'), no: INPUT.contractNumber, name: INPUT.contractName, kind: '施工', status: '履约中' })
      insert('boq_files', { id: id('source'), contract_id: id('contract'), file_name: '受控合同清单.xlsx', parse_status: 'parsed' })
      for (const [key, name, code, quantity, price, trade] of [
        ['wall', INPUT.wall.name, 'WALL', INPUT.wall.quantity, INPUT.wall.price, '泥水工'],
        ['floor', INPUT.floor.name, 'FLOOR', INPUT.floor.quantity, INPUT.floor.price, '泥水工'],
        ['pipe', INPUT.pipe.name, INPUT.pipe.code, INPUT.pipe.field, INPUT.pipe.price, '水暖工'],
      ] as const) {
        insert('items', { id: id(`item-${key}`), project_id: id('project'), code, name, trade, unit: key === 'pipe' ? 'm' : '㎡' })
        insert('boq_lines', { id: id(key), boq_file_id: id('source'), project_id: id('project'), contract_id: id('contract'), item_id: id(`item-${key}`), item_name: name, unit: key === 'pipe' ? 'm' : '㎡', qty: quantity, unit_price: price, amount: quantity * price, unit_type: INPUT.unitType, room: INPUT.room, trace_key: `${key}:1` })
      }
      insert('owner_change_orders', { id: id('ledger'), project_id: id('project'), contract_id: id('contract'), change_no: INPUT.changeNumber, name: '墙砖调整', source_type: 'boq_change_order', source_id: id('change'), source_locked: 1, status: 'approved', applied_amount: 520 })
      insert('boq_change_orders', { id: id('change'), project_id: id('project'), contract_id: id('contract'), code: INPUT.changeNumber, name: '墙砖调整', change_type: 'qty', status: 'approved', approved_at: '2026-04-02', ledger_id: id('ledger'), total_amount: 520 })
      insert('boq_change_lines', { id: id('change-line'), change_order_id: id('change'), boq_line_id: id('wall'), operation: 'qty', delta_qty: INPUT.wall.delta, amount: 520 })
      insert('monthly_statements', { id: id('monthly'), project_id: id('project'), contract_id: id('contract'), month: INPUT.sourceMonth, total_amount: INPUT.floor.amount })
      insert('monthly_statement_lines', { id: id('monthly-line'), statement_id: id('monthly'), boq_line_id: id('floor'), item_name: INPUT.floor.name, unit: '㎡', auto_qty: INPUT.floor.quantity, unit_price: INPUT.floor.price, amount: INPUT.floor.amount })
      insert('house_type_templates', { id: id('template'), project_id: id('project'), code: INPUT.unitType, name: INPUT.unitType })
      // 模板触发器已建立唯一整户房间；只使用这份权威默认房间。
      const roomId = db.exec('SELECT id FROM rooms WHERE template_id = ? AND kind = ?', [id('template'), 'whole_unit'])[0]?.values[0]?.[0]
      expect(typeof roomId).toBe('string')
      insert('house_type_template_items', { id: id('template-line'), room_id: String(roomId), item_id: id('item-pipe'), boq_line_id: id('pipe'), contract_qty: INPUT.pipe.field, provisional_qty: INPUT.pipe.confirmed, field_qty: INPUT.pipe.field })
      insert('buildings', { id: id('building'), project_id: id('project'), code: 'B1', name: '受控一栋' })
      insert('floors', { id: id('floor-source'), building_id: id('building'), code: 'F1', name: '一层' })
      insert('units', { id: id('unit'), floor_id: id('floor-source'), house_type_template_id: id('template'), code: '101' })
      insert('construction_stages', { id: id('stage'), project_id: id('project'), code: 'PIPE', name: INPUT.pipe.name, trade: '水暖工' })
      insert('construction_stage_items', { id: id('mapping'), stage_id: id('stage'), item_id: id('item-pipe'), is_reporting_stage: 1 })
      insert('crews', { id: id('crew'), name: '受控水暖班组', trade: '水暖工' })
      insert('unit_assignments', { id: id('assignment'), unit_id: id('unit'), trade: '水暖工', crew_id: id('crew') })
      insert('unit_stage_completions', { id: id('completion'), unit_id: id('unit'), stage_id: id('stage'), assignment_id: id('assignment'), status: 'completed', completed_at: `${INPUT.generationMonth}-15` })
    })
    const response = await page.goto('/contract/boq')
    expect(response?.ok()).toBe(true)
    await expect(page.getByTestId('boq-workspace-header'), '清单应用壳须先完成启动').toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('boq-contract-number')).toHaveText(INPUT.contractNumber, { timeout: 30_000 })
    await use({ projectId: id('project'), contractId: id('contract'), changeId: id('change'), wallId: id('wall'), pageErrors })
  }, { auto: true, timeout: 90_000 }],
})

function boqWorkbook(includeUnitPrice = true, input = { quantity: INPUT.pipe.quantity, price: INPUT.pipe.price }): Buffer {
  const workbook = XLSX.utils.book_new()
  const header = ['分部', '工种', '分项编码', '分项名称', '单位', '工程量']
  const row: (string | number)[] = ['机电安装', '水暖工', INPUT.pipe.code, INPUT.pipe.name, 'm', input.quantity]
  if (includeUnitPrice) {
    header.push('不含税单价')
    row.push(input.price)
  }
  header.push('户型', '房间')
  row.push(INPUT.unitType, INPUT.room)
  const sheet = XLSX.utils.aoa_to_sheet([
    [`${INPUT.projectName}户内装修清单`],
    header,
    row,
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, INPUT.sheetName)
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
  test('独立正式来源展示有效合同值、签证台账与月报量', async ({ page, boq }) => {
    await expect(page.getByRole('heading', { name: '合同工程量清单' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('project-switcher-trigger')).toContainText(INPUT.projectName)
    await expect(page.getByTestId('boq-contract-number')).toHaveText(INPUT.contractNumber)
    await expect(page.getByTestId('boq-contract-number')).toHaveAttribute('title', INPUT.contractNumber)
    await expect(page.getByRole('link', { name: INPUT.contractName })).toBeVisible()
    const amountValues = page.locator('.boq-summary-strip dd')
    await expect(amountValues).toHaveCount(4)
    for (const amount of await amountValues.all())
      expect(await amount.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const wallRow = page.getByRole('row').filter({ hasText: '墙砖铺贴' }).first()
    await expect(wallRow).toBeVisible()
    await expect(page.getByText(`(原 ${INPUT.wall.quantity})`, { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: /变更单/ }).click()
    await expect(page.getByRole('link', { name: INPUT.changeNumber, exact: true }))
      .toHaveAttribute('href', `/owner/change/${boq.changeId}`)
    await expect(page.getByText('已签证', { exact: true }).last()).toBeVisible()

    await page.getByRole('tab', { name: /月度报量/ }).click()
    await expect(page.getByRole('button', { name: new RegExp(INPUT.sourceMonth) })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '地砖铺贴' })).toBeVisible()
    await expect(page.getByText(String(INPUT.floor.quantity), { exact: true }).first()).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
    expect(boq.pageErrors).toEqual([])
  })

  test('键盘可在三个工作台标签间移动，并保持直接业务入口可聚焦', async ({ page }) => {
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('boq-contract-number')).toHaveText(INPUT.contractNumber)

    const linesTab = page.getByRole('tab', { name: /合同清单/ })
    await expect(linesTab).toHaveAttribute('data-state', 'active')
    await linesTab.focus()
    await expect(linesTab).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /变更单/ })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('link', { name: INPUT.changeNumber, exact: true })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /月度报量/ })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('link', { name: '打开甲方报量单' })).toBeVisible()
  })

  for (const input of [
    { quantity: 43, confirmed: 44, price: 36, amount: '¥1,584.00' },
    { quantity: 11.5, confirmed: 12.5, price: 18, amount: '¥225.00' },
  ]) {
    test(`三步拆表 ${input.quantity}→${input.confirmed} × ${input.price} 回接户型工程量`, async ({ page, boq }) => {
      await page.goto(`/contract/boq/import?project=${boq.projectId}&contract=${boq.contractId}`)
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('heading', { name: '合同清单拆表' })).toBeVisible()

      const chooserPromise = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '选择文件', exact: true }).click()
      const chooser = await chooserPromise
      await chooser.setFiles({
        name: INPUT.fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: boqWorkbook(true, input),
      })

      await expect(page.getByText('已识别 A 类', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '下一步：人工确认', exact: true }).click()
      await expect(page.getByRole('heading', { name: '人工确认列映射' })).toBeVisible()
      await page.getByRole('button', { name: '下一步：结果预览', exact: true }).click()
      await expect(page.getByRole('heading', { name: '拆表结果预览' })).toBeVisible()
      const quantityInput = page.getByLabel(`单套量 ${INPUT.pipe.name}`)
      await expect(quantityInput).toHaveValue(String(input.quantity))
      await quantityInput.fill(String(input.confirmed))
      await page.getByRole('button', { name: '确认导入 1 行', exact: true }).click()

      await expect(page).toHaveURL(/\/contract\/boq\?/)
      await expect(page.getByText('已导入 1 行，1 行已回接户型工程量', { exact: true })).toBeVisible()
      const imported = page.getByRole('row').filter({ hasText: `${INPUT.fileName}·${INPUT.sheetName}·3` })
      await expect(imported).toContainText(String(input.confirmed))
      await expect(page.getByRole('cell', { name: input.amount, exact: true }).first()).toBeVisible()
    })
  }

  test('导入映射缺少必填列时保留错误状态并指出需修复字段', async ({ page, boq }) => {
    await page.goto(`/contract/boq/import?project=${boq.projectId}&contract=${boq.contractId}`)
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

  test('生成月度报量按所选取数基准计算并在单据上冻结基准', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/contract/boq?tab=monthly')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: '生成月度报量' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('报量月份').fill(INPUT.generationMonth)
    // 默认现场复核量；本次显式改用暂估量，验证基准真的参与取数而不是只改标签。
    await dialog.getByLabel('取数基准').selectOption('暂估量')
    await dialog.getByRole('button', { name: '生成草稿' }).click()

    await expect(page.getByText(`${INPUT.generationMonth} 月度报量草稿已按暂估量生成`)).toBeVisible()
    await expect(page.getByText('取数基准 暂估量')).toBeVisible()
    // 暂估量 44 × 合同单价 36 = 1584，而非现场量 42 的 1512。
    // vxe-table 固定列会把一行拆成两个 tr，因此按单元格断言而不是按整行。
    await expect(page.getByRole('cell', { name: '给排水管安装', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: String(INPUT.pipe.confirmed), exact: true }).first()).toBeVisible()
    await expect(page.getByRole('cell', { name: INPUT.pipe.provisionalAmount, exact: true }).first()).toBeVisible()
    await expect(page.getByText(INPUT.pipe.fieldAmount)).toHaveCount(0)

    // 草稿阶段基准仍可换：改回现场复核量后金额随之重算。
    await page.getByRole('button', { name: '换基准重算' }).click()
    const regenerateDialog = page.getByRole('dialog')
    await expect(regenerateDialog).toBeVisible()
    await regenerateDialog.getByLabel('取数基准').selectOption('现场复核量')
    await regenerateDialog.getByRole('button', { name: '重算草稿' }).click()

    await expect(page.getByText('草稿已按现场复核量重算')).toBeVisible()
    await expect(page.getByText('取数基准 现场复核量')).toBeVisible()
    await expect(page.getByRole('cell', { name: INPUT.pipe.fieldAmount, exact: true }).first()).toBeVisible()

    await expectDocumentDoesNotOverflow(page)
    expect(pageErrors).toEqual([])
  })

  test('未确认迁入的清单目标跨域保留稳定引用，并显示来源不可用', async ({ page, boq }) => {
    // 正式模板写入与BOQ关联见 quantity-central-ui.spec.ts；中央BOQ楼层定位见 schedule-central.spec.ts。
    // 本例保留迁移前来源边界，不能把它默认为另一份中央项目或重启已退役的本地表单。
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: /现场算式：墙砖铺贴/ }).first().click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\?.*boqLine=/)
    let destination = new URL(page.url())
    expect(destination.searchParams.get('project')).toBe(boq.projectId)
    expect(destination.searchParams.get('boqLine')).toBe(boq.wallId)
    await expect(page.getByText('来自合同工程量清单', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('当前来源的项目不可用、已删除或无权读取')
    await expect(page.getByRole('button', { name: '保存模板', exact: true })).toHaveCount(0)

    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /楼层计划：墙砖铺贴/ }).first().click()
    await expect(page).toHaveURL(/\/schedule\?.*boqLine=/)
    destination = new URL(page.url())
    expect(destination.searchParams.get('project')).toBe(boq.projectId)
    expect(destination.searchParams.get('boqLine')).toBe(boq.wallId)
    await expect(page.getByRole('alert')).toContainText('当前来源的项目已删除、无权访问或身份不匹配')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('清单页头部保持紧凑，固定操作列不挤占页面且横滚留在表格内', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })

    const header = page.getByTestId('boq-workspace-header')
    await expect(header).toBeVisible()
    expect((await header.boundingBox())?.height).toBeLessThanOrEqual(190)

    const fixedActions = page.locator('.boq-lines-layout .vxe-table--fixed-right-wrapper').first()
    await expect(fixedActions).toBeVisible()
    expect((await fixedActions.boundingBox())?.width).toBeLessThanOrEqual(160)

    const tablePanel = page.locator('.boq-lines-layout .vxe-table').first()
    const horizontalScroller = page.locator('.boq-lines-layout .vxe-table--scroll-x-wrapper').first()
    await expect(horizontalScroller).toBeVisible()
    await expect(async () => {
      const [tableBox, scrollerBox] = await Promise.all([tablePanel.boundingBox(), horizontalScroller.boundingBox()])
      expect(scrollerBox!.x).toBeGreaterThanOrEqual(tableBox!.x)
      expect(scrollerBox!.x + scrollerBox!.width).toBeLessThanOrEqual(tableBox!.x + tableBox!.width + 1)
    }).toPass({ timeout: 5_000 })
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
    expect(await handle.evaluate(element => getComputedStyle(element).cursor)).toBe('col-resize')
    const handleBox = (await handle.boundingBox())!
    const headerBox = (await unitTypeHeader.boundingBox())!
    expect(handleBox.width).toBeGreaterThan(0)
    expect(handleBox.width).toBeLessThanOrEqual(12)
    expect(handleBox.x).toBeLessThanOrEqual(headerBox.x + headerBox.width)
    expect(handleBox.x + handleBox.width).toBeGreaterThanOrEqual(headerBox.x + headerBox.width)

    const actionFixed = page.locator('.boq-lines-table .vxe-table--fixed-right-wrapper')
    const actionWidthBefore = (await actionFixed.boundingBox())!.width
    await expect(actionFixed.locator('.vxe-cell--col-resizable')).toHaveCount(0)

    const widthBefore = (await unitTypeHeader.boundingBox())!.width
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

  test('清单/变更/报量在各宽度全部可达且页面不横滚', async ({ page, boq }) => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 900 },
      { width: 1440, height: 1000 },
    ] as const
    await page.goto('/contract/boq')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: /变更单/ }).click()
    const changeTable = page.locator('.boq-change-table')
    const changeActionHeader = changeTable.getByRole('columnheader', { name: '操作', exact: true }).last()
    await expect(changeActionHeader.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(page.getByRole('tab', { name: /合同清单/ }), `${viewport.width}px`).toBeVisible()
      await expect(page.getByRole('button', { name: '新建变更单', exact: true }), `${viewport.width}px`).toBeVisible()
      await expect(changeActionHeader, `${viewport.width}px`).toBeVisible()
      await expect.poll(async () => (await changeActionHeader.boundingBox())?.width ?? Infinity, { message: `${viewport.width}px` }).toBeLessThanOrEqual(58)
      await expect(changeTable.getByRole('button', { name: /变更单操作/ }).last(), `${viewport.width}px`).toBeVisible()
    }

    await page.getByRole('tab', { name: /月度报量/ }).click()
    await expect(page.getByText('自动汇总 + 手调留痕', { exact: true })).toBeVisible()
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expectDocumentDoesNotOverflow(page)
    }

    await page.goto(`/contract/boq/import?project=${boq.projectId}&contract=${boq.contractId}`)
    await page.waitForLoadState('networkidle')
    const importHeading = page.getByRole('heading', { name: '合同清单拆表' })
    await expect(importHeading).toBeVisible()
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(importHeading, `${viewport.width}px`).toBeVisible()
      await expectDocumentDoesNotOverflow(page)
    }
  })
})
