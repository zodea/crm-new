import { expect, test } from '@playwright/test'

async function openKitPage(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dev/kit-ui')
  await page.waitForLoadState('networkidle')
}

test.describe('Issue #172：全局浮层契约收缩', () => {
  test('模态期间 Toast 可读、可操作且不关闭 Dialog', async ({ page }) => {
    await openKitPage(page)
    await page.getByRole('button', { name: '软删除（可撤回）' }).click()

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: '已删除「测试项目」' })
    await expect(toast).toBeVisible()
    await page.getByRole('button', { name: 'simple（归档后修改）' }).click()

    const dialog = page.getByRole('dialog', { name: '修改已归档发票' })
    const toaster = toast.locator('xpath=ancestor::*[@data-sonner-toaster]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('z-index', '9000')
    await expect(toaster).toHaveCSS('z-index', '9100')

    await toast.getByRole('button', { name: '撤回' }).click()
    await expect(page.getByText('记录已恢复到原位置', { exact: true })).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('页签菜单在模态激活后关闭，且不能从页面层重新越过遮罩', async ({ page }) => {
    await openKitPage(page)
    const activeTab = page.locator('[data-shell-tab][data-active="true"]')

    await activeTab.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('z-index', '9000')

    await page.getByRole('button', { name: 'simple（归档后修改）' }).click()
    const dialog = page.getByRole('dialog', { name: '修改已归档发票' })
    await expect(dialog).toBeVisible()
    await expect(menu).toBeHidden()

    await activeTab.click({ button: 'right', force: true })
    await expect(menu).toBeHidden()
    await expect(dialog).toBeVisible()
  })

  test('全屏编辑和开发面板只消费定稿语义令牌', async ({ page }) => {
    await openKitPage(page)
    await page.getByRole('button', { name: '打开 Mock 数据工具' }).click()
    const devPanel = page.locator('.fixed.inset-0').filter({ hasText: '开发工具' })
    await expect(devPanel).toHaveCSS('z-index', '8900')
    await devPanel.getByRole('button').first().click()

    await page.goto('/owner/change/new')
    await expect(page.getByRole('heading', { name: '新建 · 甲方变洽签' })).toBeVisible()
    const lineGrid = page.locator('#section-lines')
    await page.getByRole('button', { name: '全屏编辑' }).click()
    await expect(lineGrid).toHaveCSS('z-index', '100')

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return {
        fullscreen: style.getPropertyValue('--z-page-fullscreen').trim(),
        legacyDrawer: style.getPropertyValue('--z-shell-drawer').trim(),
        legacyModal: style.getPropertyValue('--z-shell-modal').trim(),
        legacyOverlay: style.getPropertyValue('--z-shell-overlay').trim(),
        legacyPopover: style.getPropertyValue('--z-shell-popover').trim(),
      }
    })
    expect(tokens).toEqual({
      fullscreen: '100',
      legacyDrawer: '',
      legacyModal: '',
      legacyOverlay: '',
      legacyPopover: '',
    })
  })
})
