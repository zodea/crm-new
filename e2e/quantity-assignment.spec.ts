import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

async function openCellConfigure(
  page: import('@playwright/test').Page,
  index: number,
) {
  const cell = page.getByTestId('quantity-matrix-cell').nth(index)
  await cell.focus()
  await cell.press('Enter')
  await page.locator('[data-quantity-action="configure"]').press('Enter')
  return cell
}

test.describe('Issue #103 Slice 4：户×工种责任配置', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60_000)
    await installQuantityProductionFixture(page)
  })

  test('冲突取消保留选择，确认替换只更新当前责任并保留完成时责任', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible()

    const cell = await openCellConfigure(page, 0)
    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await expect(editor).toBeVisible()
    await expect(editor.getByText(/已选\s*1\s*\/\s*4 户/)).toBeVisible()
    await expect(editor.getByRole('checkbox', { name: '选择2层201户' })).toBeChecked()
    await expect(editor.getByRole('combobox', { name: '工种' })).toContainText('泥水工')

    const crewSelect = editor.getByRole('combobox', { name: '班组' })
    await crewSelect.click()
    await page.getByRole('option', { name: /泥水B班/ }).click()
    await editor.getByRole('button', { name: '保存责任' }).click()

    let replacement = page.getByRole('dialog').filter({ hasText: '替换现有责任' }).last()
    await expect(replacement).toContainText('2层 201户：泥水A班 → 泥水B班')
    await replacement.getByRole('button', { name: '取消', exact: true }).click()

    await expect(editor).toBeVisible()
    await expect(crewSelect).toContainText('泥水B班')
    await expect(editor.getByRole('checkbox', { name: '选择2层201户' })).toBeChecked()

    await editor.getByRole('button', { name: '保存责任' }).click()
    replacement = page.getByRole('dialog').filter({ hasText: '替换现有责任' }).last()
    await replacement.getByRole('button', { name: '确认替换', exact: true }).click()

    // 先等二次确认浮层真正退出；否则底层编辑器因 aria-hidden 会让
    // toBeHidden 在保存尚未开始时产生假阳性。
    await expect(replacement).toBeHidden()
    // 保存包含责任工作区与矩阵读模型的完整刷新，在 CI/sql.js 下可能超过
    // Playwright 默认 5 秒；仍以用户看到弹窗关闭作为完成信号。
    await expect(editor).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('已更新 1 户的 泥水工 责任')).toBeVisible()
    await expect(cell).toHaveAccessibleName(/当前责任：.*泥水工 泥水B班/)
    await expect(cell).toHaveAccessibleName(/执行责任 泥水A班/)
    expect(pageErrors).toEqual([])
  })

  test('个人责任按所选户型细化房间分项并可重新打开回显', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible()
    await page.getByRole('button', { name: '责任配置', exact: true }).click()

    let editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await editor.getByRole('combobox', { name: '工种' }).click()
    await page.getByRole('option', { name: '水暖工', exact: true }).click()
    await editor.getByRole('tab', { name: '个人责任' }).click()
    await editor.getByRole('combobox', { name: '个人' }).click()
    await page.getByRole('option', { name: /周伟峰/ }).click()
    await editor.getByRole('checkbox', { name: '选择2层202户' }).check()
    await editor.getByRole('tab', { name: '指定房间分项' }).click()
    const scope = editor.getByRole('checkbox', { name: /选择202户.*给排水管安装/ })
    await scope.check()
    await editor.getByRole('button', { name: '保存责任' }).click()

    await expect(editor).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('已更新 1 户的 水暖工 责任')).toBeVisible()

    const tradeFilter = page.getByRole('combobox', { name: '工种' })
    await tradeFilter.click()
    await page.getByRole('option', { name: '水暖工', exact: true }).click()
    await openCellConfigure(page, 1)

    editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await expect(editor.getByRole('tab', { name: '个人责任' })).toHaveAttribute('data-state', 'active')
    await expect(editor.getByRole('combobox', { name: '个人' })).toContainText('周伟峰')
    await expect(editor.getByRole('tab', { name: '指定房间分项' })).toHaveAttribute('data-state', 'active')
    await expect(editor.getByRole('checkbox', { name: /选择202户.*给排水管安装/ })).toBeChecked()
    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor).toBeHidden()
    expect(pageErrors).toEqual([])
  })

  test('责任编辑器 Esc 关闭后焦点回到触发按钮并解除背景滚动锁', async ({ page }) => {
    await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible()

    const trigger = page.getByRole('button', { name: '责任配置', exact: true })
    await trigger.click()
    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await expect(editor).toBeVisible()
    // 浮层打开期间锁住背景滚动是既有契约的一部分。
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')

    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden()
    await expect(trigger).toBeFocused()
    // 关闭后必须解锁：残留 overflow/pointer-events 会让整页失去滚动与点击。
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden')
    await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none')
  })

  test('390px 责任编辑器不撑宽页面，楼层批选可用键盘操作', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('quantity-matrix-cell').first()).toBeVisible()
    await page.getByRole('button', { name: '责任配置', exact: true }).click()

    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    const floorToggle = editor.getByRole('checkbox', { name: '选择2层全部户' })
    await floorToggle.focus()
    await floorToggle.press('Space')
    await expect(floorToggle).toBeChecked()
    await expect(editor.getByText(/已选\s*2\s*\/\s*4 户/)).toBeVisible()

    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  })
})
