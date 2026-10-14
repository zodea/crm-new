import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

const viewports = [390, 768, 1024, 1280, 1440]
const matrixInput = {
  person: { name: '正式工程量个人', phone: '13800000003', trade: '水暖工', bankName: '示例银行', bankAccount: '6222000000005678' },
  buildings: { main: '1栋', other: '2栋' },
  floors: ['2', '1'],
  suffixes: ['01', '02'],
  history: [
    { unit: '101', stage: '泥水完成', status: 'completed', date: '2026-05-15', note: '跨月墙砖阶段' },
    { unit: '101', stage: '地砖完成', status: 'completed', date: '2026-06-15', note: '跨月地砖阶段' },
    { unit: '201', stage: '地砖完成', status: 'draft', date: '2026-08-02', note: '缺少验收照片的草稿异常' },
  ] as const,
  month: { label: '2026年05月', stage: '泥水完成', latest: '地砖完成' },
  keyboard: [{ from: '201', key: 'ArrowRight', to: '202' }, { from: '202', key: 'ArrowDown', to: '102' }],
  batch: { unit: '201户', date: '2026-08-20' },
  emptyProject: '正式工程量无区域项目',
}
function unitCell(page: Page, code: string) {
  return page.getByRole('button', { name: new RegExp(`^[12]层，${code}户；`) })
}
async function installMatrixFixture(page: Page) {
  const f = await installQuantityProductionFixture(page, { detailedStages: true })
  const person = await f.create('workers', 'worker:write', { ...matrixInput.person, capabilityTrades: [matrixInput.person.trade], capabilityItems: ['给排水管安装'], safetyEducation: true, projectStatus: '在场' })
  const building = await f.execute({ kind: 'create-building', draft: { code: 'B2', name: matrixInput.buildings.other } })
  const otherUnits: string[] = []
  for (const floorNumber of matrixInput.floors) {
    const floor = await f.execute({ kind: 'create-floor', buildingId: building.id, draft: { code: `F${floorNumber}`, name: `${floorNumber}层` } })
    for (const suffix of matrixInput.suffixes) {
      const code = `${floorNumber}${suffix}`
      const unit = await f.execute({ kind: 'create-unit', floorId: floor.id, draft: { code, name: `${code}户`, templateId: f.templateId } })
      otherUnits.push(unit.id)
    }
  }
  await f.execute({ kind: 'save-assignments', draft: { projectId: f.projectId, trade: matrixInput.person.trade, assigneeKind: 'worker', assigneeId: person.id, unitIds: [otherUnits[0]!], expectedAssignments: [{ unitId: otherUnits[0]!, assignmentId: null, fingerprint: null }], scopes: [], allowReplacement: false } })
  const contentBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='
  for (const row of matrixInput.history) {
    const unitId = f.units[row.unit]!
    const workspace = (await f.read('completion', { unitId })).data
    const stage = workspace.stages.find((candidate: { name: string }) => candidate.name === row.stage)
    expect(stage).toBeTruthy()
    await f.execute({ kind: 'save-completion', draft: { projectId: f.projectId, unitId, stageId: stage.id, status: row.status, completedAt: row.date, note: row.note, expectedCompletionId: null, expectedCompletionFingerprint: null, expectedAssignmentId: stage.currentAssignment.id, photos: row.status === 'draft' ? [] : [{ fileName: `${row.stage}验收.png`, mimeType: 'image/png', fileSize: Buffer.from(contentBase64, 'base64').length, contentBase64 }] } })
  }
  await page.reload()
  await expect(unitCell(page, '101')).toBeVisible()
  return f
}

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #103 Slice 2：只读工程量矩阵', () => {
  test('正式中央事实贯通路由、双视角和跨月阶段摘要', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await installMatrixFixture(page)

    await expect(page.getByRole('grid', { name: '工程量楼层房号矩阵' })).toBeVisible()
    await expect(page.getByText('路由: /subcontract/quantity · 待实现')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '工种矩阵' })).toHaveAttribute('data-state', 'active')

    await page.getByRole('tab', { name: '班组矩阵' }).click()
    const assigneeFilter = page.getByRole('combobox', { name: '班组/个人', exact: true })
    await expect(assigneeFilter).toBeVisible()
    await assigneeFilter.click()
    await page.getByRole('option', { name: `${matrixInput.person.name}（个人）`, exact: true }).click()
    await page.getByRole('combobox', { name: '楼栋', exact: true }).click()
    await page.getByRole('option', { name: matrixInput.buildings.other, exact: true }).click()
    await expect(page.getByText(/有责任或进度/)).toContainText('1 / 4 户')
    await expect(unitCell(page, '201')).toHaveAccessibleName(new RegExp(matrixInput.person.name))
    await page.getByRole('combobox', { name: '楼栋', exact: true }).click()
    await page.getByRole('option', { name: matrixInput.buildings.main, exact: true }).click()
    await page.getByRole('tab', { name: '工种矩阵' }).click()

    const cells = page.getByTestId('quantity-matrix-cell')
    await expect(cells).toHaveCount(4)
    await expect(unitCell(page, '201')).toContainText('草稿异常 1')
    await expect(unitCell(page, '201')).toHaveAccessibleName(/另有 1 条草稿异常/)
    const tabbable = await cells.evaluateAll(elements => elements.filter(element => element.getAttribute('tabindex') === '0').length)
    expect(tabbable).toBe(1)

    for (const move of matrixInput.keyboard) {
      await unitCell(page, move.from).focus()
      await unitCell(page, move.from).press(move.key)
      await expect(unitCell(page, move.to)).toBeFocused()
    }

    // 1层 01户在 5/6 月分别完成墙砖与地砖；总览只显示 6 月最近阶段，完整记录进入独立详情页。
    const monthFilter = page.getByRole('combobox', { name: '月份', exact: true })
    await monthFilter.click()
    await page.getByRole('option', { name: matrixInput.month.label, exact: true }).click()
    await expect(unitCell(page, '101')).toContainText(matrixInput.month.stage)
    await monthFilter.click()
    await page.getByRole('option', { name: '全部月份', exact: true }).click()
    await expect(page.getByRole('option', { name: '全部月份', exact: true })).toHaveCount(0)
    await expect(monthFilter).toBeFocused()
    await unitCell(page, '101').focus()
    await expect(unitCell(page, '101')).toContainText(matrixInput.month.latest)
    await unitCell(page, '101').press('Enter')
    const configure = page.getByRole('button', { name: '配置 101户' })
    const complete = page.getByRole('button', { name: '登记 101户' })
    const detail = page.getByRole('button', { name: '详情 101户' })
    await expect(configure).toBeFocused()
    await configure.press('Tab')
    await expect(complete).toBeFocused()
    await complete.press('Tab')
    await expect(detail).toBeFocused()
    await detail.click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\/[^/]+\/[^/?]+\?/)
    await expect(page.getByRole('heading', { name: /1栋 1层 101户/ })).toBeVisible()
    await page.getByRole('link', { name: '返回工程量矩阵' }).click()
    await expect(page.getByRole('combobox', { name: '月份', exact: true })).toHaveText(/全部月份/)
    expect(pageErrors).toEqual([])
  })

  test('无区域数据项目显示真实空态', async ({ page }) => {
    const f = await installQuantityProductionFixture(page)
    await f.create('projects', 'project:write', { name: matrixInput.emptyProject, manager: '合成经办人', status: '筹备中' }, 'draft')
    await page.reload()
    await page.getByRole('combobox', { name: '项目', exact: true }).click()
    await page.getByRole('option', { name: new RegExp(matrixInput.emptyProject) }).click()

    await expect(page.getByText('当前项目尚未配置楼栋和户')).toBeVisible()
    await expect(page.getByRole('grid', { name: '工程量楼层房号矩阵' })).toHaveCount(0)
  })

  test('整工种批量完成展开到户×阶段并按缺照片规则回显草稿', async ({ page }) => {
    await installQuantityProductionFixture(page, { detailedStages: true })

    await page.getByRole('button', { name: '批量完成', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '整工种批量完成' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: `选择2层${matrixInput.batch.unit}`, exact: true }).check()
    await dialog.getByLabel('完成日期').fill(matrixInput.batch.date)
    await dialog.getByRole('button', { name: '展开阶段', exact: true }).click()
    await expect(dialog.getByText(/将提交 \d+ 项/)).toBeVisible()

    await dialog.getByRole('button', { name: '提交批量登记', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('提交结果（按阶段回显）')
    await expect(dialog.getByRole('status')).toContainText('存草稿 · 缺验收照片')
  })

  test('页面在各宽度不横滚且矩阵可在自身区域滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installQuantityProductionFixture(page, { detailedStages: true })

    const scroller = page.getByTestId('quantity-matrix-scroll')
    await expect(scroller).toBeVisible()
    for (const width of viewports) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      const metrics = await scroller.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          client: element.clientWidth,
          scroll: element.scrollWidth,
          overflowX: style.overflowX,
        }
      })
      if (width === 390)
        expect(metrics.scroll).toBeGreaterThan(metrics.client)
      else
        expect(metrics.scroll).toBeGreaterThanOrEqual(metrics.client)
      expect(metrics.overflowX).toMatch(/auto|scroll/)
      await documentDoesNotOverflow(page)
    }
  })
  test('量差总表读取真实三量并在窄屏浮层内局部横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installQuantityProductionFixture(page, { detailedStages: true })

    const trigger = page.getByRole('button', { name: '量差总表' })
    await trigger.click()
    const dialog = page.getByRole('dialog').filter({ hasText: '量差总表' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/不产生独立台账/)).toBeVisible()
    await expect(dialog.getByRole('combobox', { name: '对比口径' })).toBeVisible()
    await expect(dialog.locator('[data-ui="kit-table"]')).toBeVisible()
    await documentDoesNotOverflow(page)

    const tableScroll = dialog.locator('[data-ui="kit-table"] .vxe-table--body-inner-wrapper').first()
    const widths = await tableScroll.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(widths.scroll).toBeGreaterThan(widths.client)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
