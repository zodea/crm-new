import { expect, test } from '@playwright/test'

test.describe('Issue #169：责任配置弹窗视觉与模态边界', () => {
  test('1740×974 下无原生外框、空网格列或背景双滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1740, height: 974 })
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: '责任配置', exact: true }).click()

    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })

    await expect(editor).toBeVisible()
    const metrics = await editor.evaluate((dialog) => {
      const nav = dialog.querySelector<HTMLElement>('.form-dialog__nav button')!
      const picker = dialog.querySelector<HTMLElement>('[data-testid="quantity-assignment-unit-picker"]')!
      const fieldset = picker.querySelector<HTMLElement>('fieldset')!
      const grid = picker.querySelector<HTMLElement>('section > div.grid')!
      const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')!
      return {
        navBorder: getComputedStyle(nav).borderTopWidth,
        fieldsetBorder: getComputedStyle(fieldset).borderTopWidth,
        fieldsetMargin: getComputedStyle(fieldset).marginTop,
        fieldsetPadding: getComputedStyle(fieldset).paddingTop,
        floorTracks: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(track => Number.parseFloat(track) > 0).length,
        floorItems: grid.childElementCount,
        workspaceOverflow: getComputedStyle(workspace).overflowY,
      }
    })

    expect(metrics).toEqual({
      navBorder: '0px',
      fieldsetBorder: '0px',
      fieldsetMargin: '0px',
      fieldsetPadding: '0px',
      floorTracks: metrics.floorItems,
      floorItems: 2,
      workspaceOverflow: 'hidden',
    })
    await expect(editor).toHaveScreenshot('responsibility-dialog-1740x974.png', {
      animations: 'disabled',
    })
  })

  test('代表视口保持内容与操作可达且不撑宽页面', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: '责任配置', exact: true }).click()

    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(editor).toBeVisible()
      await expect(editor.getByRole('button', { name: '取消', exact: true })).toBeVisible()
      await expect(editor.getByRole('button', { name: '保存责任', exact: true })).toBeVisible()

      const widths = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      expect(widths.scroll).toBeLessThanOrEqual(widths.client)
    }
  })
})
