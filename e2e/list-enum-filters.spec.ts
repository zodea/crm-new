import { expect, test } from '@playwright/test'

test('辅助合同和其他支出结算保留旧链接并提交完整多选值，默认控件无粗框', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/contract/company-expense?category=房租', '/contract/other-expense?category=机械租赁', '/contract/other-settlement?status=draft']) {
      await page.goto(path)
      const isSettlement = path.includes('other-settlement')
      const trigger = page.getByRole('button', { name: `状态，已选 ${isSettlement ? 1 : 0} 项`, exact: true })
      await expect(trigger).toBeVisible()
      if (!isSettlement) {
        if (width === 390)
          await expect(page.getByRole('button', { name: '类别，已选 1 项', exact: true })).toBeVisible()
        else
          await expect(page.getByRole('group', { name: '合同类别', exact: true }).getByRole('checkbox', { name: path.includes('company') ? '房租' : '机械租赁', exact: true })).toBeChecked()
      }
      expect(await trigger.evaluate(element => Number.parseFloat(getComputedStyle(element).borderTopWidth))).toBeLessThanOrEqual(1)
      expect(await trigger.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: /^状态/ })
      await expect(dialog).toBeInViewport()
      if (!isSettlement)
        await expect(dialog.getByRole('checkbox', { name: '已结清', exact: true })).toBeInViewport({ ratio: 1 })
      if (!isSettlement)
        await dialog.getByRole('checkbox', { name: '草稿', exact: true }).check()
      else
        await expect(dialog.getByRole('checkbox', { name: '草稿', exact: true })).toBeChecked()
      await dialog.getByRole('checkbox', { name: isSettlement ? '已确认' : '已签订', exact: true }).check()
      await dialog.getByRole('button', { name: '应用', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.getAll('status')).toEqual(isSettlement ? ['draft', 'confirmed'] : ['草稿', '已签订'])
      const selected = page.getByRole('button', { name: '状态，已选 2 项', exact: true })
      await expect(selected).toBeVisible()
      await selected.focus()
      await page.keyboard.press('Enter')
      await expect(dialog.getByRole('checkbox', { name: '草稿', exact: true })).toBeChecked()
      await page.keyboard.press('Escape')
      await expect(selected).toBeFocused()
      expect(await selected.evaluate(element => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeLessThanOrEqual(1)
      await selected.click()
      await dialog.getByRole('button', { name: '清除', exact: true }).click()
      await expect.poll(() => new URL(page.url()).searchParams.getAll('status')).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  }
})
