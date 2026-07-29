import { expect, test } from '@playwright/test'

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('标准工序库版本维护与建组甘特', () => {
  test('复用已打开的表单页签时按 source 重新初始化，并可切回空白草稿', async ({ page }) => {
    await page.goto('/schedule/process-library')
    await expect(page.getByRole('heading', { name: '标准工序库' }).last()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '新建空白工序库' }).click()
    await expect(page.getByRole('heading', { name: '新建标准工序库' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByLabel('工序库编码 *')).toHaveValue('')

    const openedTabs = page.getByRole('navigation', { name: '已打开页面' })
    await openedTabs.getByRole('button', { name: '标准工序库', exact: true }).click()
    await expect(page.getByRole('heading', { name: '标准工序库' }).last()).toBeVisible()
    await page.getByRole('link', { name: '基于此版本新建' }).first().click()
    await expect(page).toHaveURL(/\/schedule\/process-library\/form\?source=/)
    await expect(page.getByRole('heading', { name: '基于旧版新建版本' })).toBeVisible()
    await expect(page.getByLabel('工序库编码 *')).toBeDisabled()
    await expect(page.getByLabel('工序库编码 *')).not.toHaveValue('')

    await openedTabs.getByRole('button', { name: '标准工序库', exact: true }).click()
    await page.getByRole('link', { name: '新建空白工序库' }).click()
    await expect(page).toHaveURL('/schedule/process-library/form')
    await expect(page.getByRole('heading', { name: '新建标准工序库' })).toBeVisible()
    await expect(page.getByLabel('工序库编码 *')).toBeEnabled()
    await expect(page.getByLabel('工序库编码 *')).toHaveValue('')
  })

  test('基于旧版本在独立整页表单新建版本，来源版本保持可见', async ({ page }) => {
    await page.goto('/schedule/process-library')
    await expect(page.getByRole('heading', { name: '标准工序库' }).last()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('v1', { exact: true })).toBeVisible()
    await expect(page.getByText(/(已被 \d+ 个排程引用 · 只读|尚未引用)/)).toBeVisible()

    await page.getByRole('link', { name: '基于此版本新建' }).first().click()
    await expect(page).toHaveURL(/\/schedule\/process-library\/form\?source=/)
    await expect(page.getByRole('heading', { name: '基于旧版新建版本' })).toBeVisible()
    await expect(page.getByText(/来源 .*v1 保持只读/)).toBeVisible()
    await expect(page.getByRole('grid', { name: '标准工序模板甘特' })).toBeVisible()

    await page.getByRole('button', { name: '上移给排水安装' }).click()
    const reorderConfirm = page.getByRole('dialog', { name: /本次调整会冲突/ })
    await expect(reorderConfirm).toBeVisible()
    await reorderConfirm.getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('button', { name: '设置给排水安装前置工序' }))
      .not
      .toContainText('已置灰')
    await page.getByRole('button', { name: '上移给排水安装' }).click()
    await page.getByRole('dialog', { name: /本次调整会冲突/ })
      .getByRole('button', { name: '调整并置灰冲突' })
      .click()
    await expect(page.getByRole('button', { name: '设置给排水安装前置工序' }))
      .toContainText('已置灰')

    await page.getByLabel('放线及新建墙体默认工期').fill('31')
    await page.getByRole('button', { name: '保存为新版本' }).click()
    await expect(page).toHaveURL('/schedule/process-library')
    await expect(page.getByText('v2', { exact: true })).toBeVisible()
    await expect(page.getByText('v1', { exact: true })).toBeVisible()
  })

  test('390px 页面不横滚，建组第二步甘特与精确工期共用一个状态', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/schedule/new?project=proj_demo_001')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '楼栋分组与标准工序' })).toBeVisible({ timeout: 20_000 })
    const nextStep = page.getByRole('button', { name: '下一步：选择工序' })
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    await expect(page.locator('[data-schedule-wizard-step="1"] input[type="checkbox"]:checked')).toHaveCount(1)
    await expect(nextStep).toBeEnabled()
    await nextStep.click()

    const ganttScroll = page.getByTestId('template-gantt-scroll')
    await expect(ganttScroll).toBeVisible()
    expect(await ganttScroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBeTruthy()
    await page.getByRole('button', { name: '调整模板工期：放线及新建墙体' })
      .press('ArrowRight')
    await expect(page.getByRole('spinbutton', { name: '放线及新建墙体默认工期' }))
      .toHaveValue('31')

    const movePlumbing = page.getByRole('button', { name: '移动模板工序：给排水安装' })
    for (let index = 0; index < 17; index += 1)
      await movePlumbing.press('ArrowLeft')
    const conflictConfirm = page.getByRole('dialog', { name: /本次调期会冲突/ })
    await expect(conflictConfirm).toBeVisible()
    await conflictConfirm.getByRole('button', { name: '取消' }).click()
    await expect(page.getByText(/给排水安装.*已置灰/)).toHaveCount(0)
    await movePlumbing.press('ArrowLeft')
    await page.getByRole('dialog', { name: /本次调期会冲突/ })
      .getByRole('button', { name: '调期并置灰冲突' })
      .click()
    await expect(page.getByText('放线及新建墙体 · 已置灰')).toBeVisible()
    await expectDocumentDoesNotOverflow(page)
  })

  test('顺排前序后移会带动后续重算，精确日期错序仍走同一确认', async ({ page }) => {
    await page.goto('/schedule/new?project=proj_demo_001')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: '楼栋分组与标准工序' })).toBeVisible({ timeout: 20_000 })
    const nextStep = page.getByRole('button', { name: '下一步：选择工序' })
    await page.getByRole('radio', { name: /内部暂估/ }).check()
    await expect(page.locator('[data-schedule-wizard-step="1"] input[type="checkbox"]:checked')).toHaveCount(1)
    await expect(nextStep).toBeEnabled()
    await nextStep.click()
    await page.getByRole('radio', { name: '完全顺排' }).check()

    const plumbingRow = page.locator('.process-row').filter({
      has: page.getByRole('checkbox', { name: '启用给排水安装', exact: true }),
    })
    const before = await plumbingRow.textContent()
    await page.getByRole('button', { name: '移动模板工序：放线及新建墙体' }).press('ArrowRight')
    await expect(page.getByRole('dialog', { name: /本次调期会冲突/ })).toHaveCount(0)
    await expect.poll(() => plumbingRow.textContent()).not.toBe(before)

    const predecessorAnchor = page.getByLabel('放线及新建墙体锚点开始')
    const predecessorStart = await predecessorAnchor.inputValue()
    const conflictDate = new Date(`${predecessorStart}T00:00:00Z`)
    conflictDate.setUTCDate(conflictDate.getUTCDate() - 1)
    const conflictValue = conflictDate.toISOString().slice(0, 10)
    const successorAnchor = page.getByLabel('给排水安装锚点开始')
    await successorAnchor.fill(conflictValue)
    await successorAnchor.blur()
    const confirm = page.getByRole('dialog', { name: /本次调期会冲突/ })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(successorAnchor).not.toHaveValue(conflictValue)

    await successorAnchor.fill(conflictValue)
    await successorAnchor.blur()
    await page.getByRole('dialog', { name: /本次调期会冲突/ })
      .getByRole('button', { name: '调期并置灰冲突' })
      .click()
    await expect(plumbingRow.getByText('放线及新建墙体 · 已置灰')).toBeVisible()
  })
})
