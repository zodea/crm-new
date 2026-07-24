import { expect, test } from '@playwright/test'

test.describe('KitUI real-browser keyboard contracts', () => {
  test('uses arrow keys to move and activate SegTab', async ({ page }) => {
    await page.goto('/dev/kit-atoms')
    await expect(page.getByRole('heading', { name: 'KitAtoms 原子库演示' })).toBeVisible({
      timeout: 20_000,
    })

    const allTab = page.getByRole('tab', { name: '全部 34' })
    const pendingTab = page.getByRole('tab', { name: '待校对 5' })
    await allTab.focus()
    await page.keyboard.press('ArrowRight')

    await expect(pendingTab).toBeFocused()
    await expect(pendingTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('activeTab = pending', { exact: true })).toBeVisible()
  })

  test('opens and selects a SelectFilter option using only the keyboard', async ({ page }) => {
    await page.goto('/dev/kit-atoms')
    const stage = page.getByRole('combobox', { name: '阶段' })
    await expect(stage).toBeVisible({ timeout: 20_000 })

    await stage.focus()
    await page.keyboard.press('Space')
    const current = page.getByRole('option', { name: '全部阶段' })
    const next = page.getByRole('option', { name: '施工中' })
    await expect(current).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(next).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByText(/stage = progress/)).toBeVisible()
  })

  test('puts safe dialog focus on cancel and returns Escape as cancellation', async ({ page }) => {
    await page.goto('/dev/kit-ui')
    await expect(page.getByRole('button', { name: 'simple（归档后修改）' })).toBeVisible({
      timeout: 20_000,
    })

    await page.getByRole('button', { name: 'simple（归档后修改）' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    await expect(page.getByText('simple confirm 返回：false', { exact: true })).toBeVisible()
  })

  test('focuses the first form field and cancels the form with Escape', async ({ page }) => {
    await page.goto('/dev/kit-ui')
    const openForm = page.getByRole('button', { name: '打开表单弹窗' })
    await expect(openForm).toBeVisible({ timeout: 20_000 })

    await openForm.click()
    const name = page.getByRole('textbox', { name: /公司全称/ })
    await expect(name).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByText('formModal 已取消（返回 null）', { exact: true })).toBeVisible()
  })
})
