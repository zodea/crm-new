import { expect, test } from '@playwright/test'

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #114：施工进度 WBS 排程', () => {
  test('真实 seed 支持改期、人工进度、基线与工程量穿透返回', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto('/schedule')
    await expect(page.getByRole('heading', { name: 'WBS 排程与实际进度' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
    await expect(page.getByText('户内1栋-2栋', { exact: true })).toBeVisible()
    await expect(page.getByRole('tree', { name: '施工排程 WBS' })).toBeVisible()

    const chartStarts = await page.locator('.timeline-row .chart-cell').evaluateAll(elements =>
      elements.slice(0, 3).map(element => Math.round(element.getBoundingClientRect().left)),
    )
    expect(new Set(chartStarts).size).toBe(1)
    await expect(page.getByText('05.06~10.23', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.dependency-path').first()).toBeVisible()

    await page.getByRole('button', { name: '放线及新建墙体', exact: true }).click()
    const manualDialog = page.getByRole('dialog', { name: /工序详情 · 放线及新建墙体/ })
    await expect(manualDialog.getByText('非工程量工序由排程人工填报')).toBeVisible()
    await manualDialog.getByRole('slider', { name: '人工进度百分比' }).fill('75')
    await manualDialog.getByRole('button', { name: '保存调整', exact: true }).click()
    await expect(page.getByText('工序计划已更新', { exact: true }).last()).toBeVisible()

    await page.getByRole('button', { name: '设置基准', exact: true }).click()
    const baselineDialog = page.getByRole('dialog', { name: '设置当前计划为基准？' })
    await baselineDialog.getByRole('button', { name: '设置基准', exact: true }).click()
    await expect(page.getByText('排程基准已保存', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: '卫生间回填及防水', exact: true }).click()
    const quantityDialog = page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })
    await expect(quantityDialog.getByText('由工程量阶段完成事实自动派生，不可手填')).toBeVisible()
    const floorPlanSection = quantityDialog.locator('section').filter({ hasText: '分项 × 楼层计划' })
    await expect(floorPlanSection).toBeVisible()
    const firstFloorPlan = floorPlanSection.locator('.bg-surface-2').first()
    await firstFloorPlan.locator('input[type="date"]').first().fill('2026-05-13')
    await quantityDialog.getByRole('button', { name: '保存调整', exact: true }).click()
    await expect(page.getByText('工序计划已更新', { exact: true }).last()).toBeVisible()

    await page.getByRole('button', { name: '卫生间回填及防水', exact: true }).click()
    await expect(page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })
      .getByText('已微调', { exact: true })
      .first()).toBeVisible()
    const reopenedQuantityDialog = page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })
    await reopenedQuantityDialog.getByRole('button', { name: '查看工程量', exact: true }).click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\?.*from=schedule/)
    await expect(page.getByText('来自施工排程 · 户内1栋-2栋')).toBeVisible()
    await expect(page.getByText('户内1栋-2栋', { exact: true }).last()).toBeVisible()
    const quantityMatrix = page.getByTestId('quantity-matrix-scroll')
    await expect(quantityMatrix.getByText('1栋 · 2层', { exact: true })).toBeVisible()
    await expect(quantityMatrix.getByText('2栋 · 2层', { exact: true })).toBeVisible()
    await expect(page.getByText(/映射分项：.*墙面防水.*地面防水/)).toBeVisible()
    await page.getByRole('link', { name: '返回该工序', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\?.*task=schedule_task_demo_03/)
    await expect(page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })).toBeVisible()

    expect(pageErrors).toEqual([])
  })

  test('工序详情切换到单层依赖弹窗，候选只含同组较早工序', async ({ page }) => {
    await page.goto('/schedule')
    await expect(page.getByRole('heading', { name: 'WBS 排程与实际进度' })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: '卫生间回填及防水', exact: true }).click()
    const detail = page.getByRole('dialog', { name: /工序详情 · 卫生间回填及防水/ })
    await detail.getByRole('button', { name: '修改依赖' }).click()

    await expect(detail).toBeHidden()
    const dependency = page.getByRole('dialog', { name: /依赖设置.*卫生间回填及防水/ })
    await expect(dependency).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(dependency.getByText('楼栋分组：户内1栋-2栋')).toBeVisible()
    await expect(dependency.getByText('完成 → 开始（FS）')).toBeVisible()
    expect((await dependency.boundingBox())?.width).toBeLessThanOrEqual(440)
    await dependency.getByRole('combobox', { name: '前置工序' }).click()
    const earlierOption = page.getByRole('option', { name: /给排水安装/ })
    await expect(earlierOption).toBeVisible()
    await expect(page.getByRole('option', { name: /电线敷设/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(earlierOption).toBeHidden()
    await dependency.getByRole('spinbutton', { name: 'Lag 天数' }).fill('17')
    await page.keyboard.press('Escape')
    const discardConfirm = page.getByRole('dialog', { name: '放弃依赖设置修改？' })
    await expect(discardConfirm).toBeVisible()
    await discardConfirm.getByRole('button', { name: '取消' }).click()
    await expect(dependency).toBeVisible()
    await dependency.getByRole('button', { name: '取消' }).click()
    await page.getByRole('dialog', { name: '放弃依赖设置修改？' })
      .getByRole('button', { name: '放弃修改' })
      .click()
    await expect(dependency).toBeHidden()
    await expect(detail).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
  })

  test('甘特可整体拖动与右缘调期，冲突取消不写入、确认后只置灰依赖', async ({ page }) => {
    await page.goto('/schedule')
    await expect(page.getByRole('heading', { name: 'WBS 排程与实际进度' })).toBeVisible({ timeout: 20_000 })

    const plumbingRow = page.locator('.label-cell.data-row[data-kind="task"]')
      .filter({ hasText: '给排水安装' })
    await expect(plumbingRow).toContainText('05.08')
    const plumbingBar = page.getByRole('button', { name: '移动工序：给排水安装' })
    await plumbingBar.scrollIntoViewIfNeeded()
    const plumbingBox = await plumbingBar.boundingBox()
    expect(plumbingBox).not.toBeNull()

    await page.mouse.move(plumbingBox!.x + plumbingBox!.width / 2, plumbingBox!.y + plumbingBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(plumbingBox!.x + plumbingBox!.width / 2 - 16, plumbingBox!.y + plumbingBox!.height / 2)
    await page.mouse.up()
    const conflictConfirm = page.getByRole('dialog', { name: /本次调期会冲突/ })
    await expect(conflictConfirm).toBeVisible()
    await conflictConfirm.getByRole('button', { name: '取消' }).click()
    await expect(plumbingRow).toContainText('05.08')
    await expect(page.locator('.dependency-path.is-disabled')).toHaveCount(0)

    const plumbingBoxAgain = await plumbingBar.boundingBox()
    expect(plumbingBoxAgain).not.toBeNull()
    await page.mouse.move(
      plumbingBoxAgain!.x + plumbingBoxAgain!.width / 2,
      plumbingBoxAgain!.y + plumbingBoxAgain!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      plumbingBoxAgain!.x + plumbingBoxAgain!.width / 2 - 16,
      plumbingBoxAgain!.y + plumbingBoxAgain!.height / 2,
    )
    await page.mouse.up()
    await page.getByRole('dialog', { name: /本次调期会冲突/ })
      .getByRole('button', { name: '调期并置灰冲突' })
      .click()
    await expect(page.getByText('计划已调整，冲突依赖已置灰', { exact: true })).toBeVisible()
    await expect(plumbingRow).not.toContainText('05.08')
    await expect(page.locator('.dependency-path.is-disabled').first()).toBeVisible()

    const cleanupRow = page.locator('.label-cell.data-row[data-kind="task"]')
      .filter({ hasText: '开荒保洁' })
    await expect(cleanupRow).toContainText('10.23')
    const finishHandle = page.getByRole('button', { name: '调整工期：开荒保洁' })
    await finishHandle.scrollIntoViewIfNeeded()
    const finishBox = await finishHandle.boundingBox()
    expect(finishBox).not.toBeNull()
    await page.mouse.move(finishBox!.x + finishBox!.width / 2, finishBox!.y + finishBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(finishBox!.x + finishBox!.width / 2 + 16, finishBox!.y + finishBox!.height / 2)
    await page.mouse.up()
    await expect(page.getByText('计划日期已调整', { exact: true })).toBeVisible()
    await expect(cleanupRow).not.toContainText('10.23')
    await expectDocumentDoesNotOverflow(page)
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 },
  ] as const) {
    test(`${viewport.width}px 页面不横滚且 WBS / 甘特操作可达`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/schedule')
      await page.waitForLoadState('networkidle')

      const scroller = page.getByTestId('schedule-scroll')
      await expect(scroller).toBeVisible()
      const ganttToggle = page.getByRole('button', { name: '甘特', exact: true })
      if (await ganttToggle.isVisible()) {
        await ganttToggle.click()
        await expect(page.getByText('7月', { exact: true }).first()).toBeVisible()
        await page.getByRole('button', { name: 'WBS', exact: true }).click()
        await expect(page.getByRole('button', { name: '放线及新建墙体', exact: true })).toBeVisible()
      }
      else {
        await expect(page.getByText('7月', { exact: true }).first()).toBeVisible()
        await expect(page.getByRole('button', { name: '放线及新建墙体', exact: true })).toBeVisible()
      }
      await expectDocumentDoesNotOverflow(page)
    })
  }

  test('新建楼栋分组按范围、工序、预览三步完成', async ({ page }) => {
    await page.goto('/subcontract/quantity/region?project=proj_demo_001')
    await page.waitForLoadState('networkidle')
    await page.getByLabel('楼栋列表').getByRole('button', { name: /3栋/ }).click()
    const floorSection = page.locator('#section-floor')
    await floorSection.getByLabel('楼层编码').fill('1F')
    await floorSection.getByLabel('显示名称').fill('1层')
    await floorSection.getByRole('button', { name: '新增楼层' }).click()
    await expect(page.getByLabel('楼层列表').getByRole('button', { name: /1层/ })).toBeVisible()
    const unitSection = page.locator('#section-unit')
    await unitSection.getByLabel('户编码').fill('101')
    await unitSection.getByLabel('显示名称').fill('101户')
    await unitSection.getByLabel('户型模板').selectOption({ index: 1 })
    await unitSection.getByRole('button', { name: '新增户' }).click()
    await expect(page.getByLabel('户列表').getByText('101户', { exact: true })).toBeVisible()

    await page.goto('/schedule/new?project=proj_demo_001')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: '楼栋分组与标准工序' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '新建排程步骤' })).toBeVisible()
    await expect(page.locator('[data-schedule-wizard-step="1"]')).toBeVisible()
    const contractSelect = page.getByRole('combobox', { name: '施工合同' })
    await expect(contractSelect).toBeVisible()
    await expect(contractSelect).toContainText(/合和新城施工总承包合同.*10 条清单/)
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    await expect(contractSelect).toHaveCount(0)
    await expect(page.locator('[data-schedule-wizard-step="1"] input[type="checkbox"]:checked')).toHaveCount(1)
    await expect(page.getByText('3栋', { exact: true })).toBeVisible()
    await expect(page.getByText(/1 层 · 1 户 · \d+ 项 · 暂估量/)).toBeVisible()
    await expect(page.locator('[data-schedule-wizard-step="2"]')).toHaveCount(0)
    await expectDocumentDoesNotOverflow(page)

    await page.getByRole('button', { name: '下一步：选择工序' }).click()
    await expect(page.locator('[data-schedule-wizard-step="2"]')).toBeVisible()
    await expect(page.getByText('FS 前置', { exact: true })).toBeVisible()
    await expect(page.locator('.process-row').filter({ has: page.locator('input[type="checkbox"]') })).toHaveCount(22)
    await expect(page.getByRole('button', { name: '生成排程', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '清空' }).click()
    await page.getByRole('checkbox', { name: '启用放线及新建墙体' }).check()

    await page.setViewportSize({ width: 390, height: 844 })
    const processScroll = page.getByTestId('schedule-new-process-scroll')
    await expect(processScroll).toBeVisible()
    expect(await processScroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBeTruthy()
    await expectDocumentDoesNotOverflow(page)

    await page.getByRole('button', { name: '下一步：预览排程' }).click()
    const previewStep = page.locator('[data-schedule-wizard-step="3"]')
    await expect(previewStep).toBeVisible()
    await expect(previewStep.getByText('范围依据', { exact: true })).toBeVisible()
    await expect(previewStep.getByText('覆盖核对', { exact: true })).toBeVisible()
    await expect(previewStep.getByText('依赖冲突', { exact: true })).toBeVisible()
    await expect(previewStep.getByText('阻断项', { exact: true })).toBeVisible()
    await expect(previewStep.locator('tbody tr')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '生成排程', exact: true })).toBeVisible()
    const previewScroll = page.getByTestId('schedule-new-preview-scroll')
    expect(await previewScroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBeTruthy()
    await expectDocumentDoesNotOverflow(page)
  })

  test('无项目区域时可直达楼栋楼层户配置并保留项目与返回参数', async ({ page }) => {
    await page.goto('/schedule/new?project=proj_demo_002')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: '楼栋分组与标准工序' })).toBeVisible()
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    await page.getByLabel('分组名称').fill('返回后保留的暂估分组')
    await expect(page.getByText('当前项目尚未维护可用楼栋，或楼栋已全部纳入排程。')).toBeVisible()
    const configureRegion = page.getByRole('link', { name: '配置楼栋、楼层与户' })
    await expect(configureRegion).toBeVisible()
    await expect(configureRegion).toHaveAttribute(
      'href',
      /\/subcontract\/quantity\/region\?project=proj_demo_002&return=schedule&resume=region/,
    )
    await configureRegion.click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\/region\?project=proj_demo_002&return=schedule&resume=region/)
    await expect(page.getByTestId('quantity-region-form')
      .getByRole('heading', { name: '项目区域配置' })).toBeVisible()
    const createTemplate = page.getByRole('link', { name: '新建户型模板' })
    await expect(createTemplate).toHaveAttribute(
      'href',
      /\/subcontract\/quantity\/template\?project=proj_demo_002&return=region&origin=schedule&resume=region/,
    )
    await createTemplate.click()
    await expect(page).toHaveURL(
      /\/subcontract\/quantity\/template\?project=proj_demo_002&return=region&origin=schedule&resume=region/,
    )
    await page.getByRole('button', { name: '返回区域配置' }).click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\/region\?project=proj_demo_002&return=schedule&resume=region/)
    await page.getByRole('button', { name: '返回新建排程' }).click()
    await expect(page).toHaveURL(/\/schedule\/new\?project=proj_demo_002&resume=region/)
    await expect(page.getByLabel('分组名称')).toHaveValue('返回后保留的暂估分组')
    await expect(page.getByRole('radio', { name: /内部暂估/ })).toBeChecked()
    await expectDocumentDoesNotOverflow(page)
  })
})
