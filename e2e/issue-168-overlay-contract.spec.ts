import { expect, test } from '@playwright/test'

test.describe('Issue #168：浮层组合契约扩展底座', () => {
  test('模态期间锁定应用工作区，嵌套关闭后不提前解锁', async ({ page }) => {
    await page.setViewportSize({ width: 1740, height: 974 })
    await page.goto('/subcontract/quantity')
    await page.waitForLoadState('networkidle')

    const trigger = page.getByRole('button', { name: '责任配置', exact: true })
    const workspace = page.locator('[data-shell-workspace]')
    await trigger.click()

    const editor = page.getByRole('dialog', { name: '户 × 工种责任配置' })
    await expect(editor).toBeVisible()
    await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden')

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        plane: style.getPropertyValue('--z-overlay-plane').trim(),
        backdrop: style.getPropertyValue('--z-overlay-backdrop').trim(),
        surface: style.getPropertyValue('--z-overlay-surface').trim(),
        owned: style.getPropertyValue('--z-overlay-owned').trim(),
        toast: style.getPropertyValue('--z-toast').trim(),
        fullscreen: style.getPropertyValue('--z-page-fullscreen').trim(),
      }
    })
    expect(tokens).toEqual({
      plane: '9000',
      backdrop: '9000',
      surface: '9000',
      owned: '9000',
      toast: '9100',
      fullscreen: '100',
    })

    await editor.getByRole('checkbox', { name: '选择2层202户' }).check()
    await editor.getByRole('button', { name: '取消', exact: true }).click()

    const discard = page.getByRole('dialog', { name: '放弃未保存配置' })
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: '取消', exact: true }).click()
    await expect(discard).toBeHidden()
    await expect(editor).toBeVisible()
    await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden')

    await editor.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog', { name: '放弃未保存配置' })
      .getByRole('button', { name: '放弃配置', exact: true })
      .click()

    await expect(editor).toBeHidden()
    await expect.poll(() => workspace.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto')
    await expect(trigger).toBeFocused()
  })
})
