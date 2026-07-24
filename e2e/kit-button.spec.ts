import { expect, test } from '@playwright/test'

test.describe('KitButton 三态原语', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/kit-ui')
    await expect(page.getByRole('button', { name: '模拟提交', exact: true })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('loading 立即禁用、保留原文并锁定宽度', async ({ page }) => {
    const button = page.getByRole('button', { name: '模拟提交', exact: true })
    const counter = page.getByText(/提交调用次数：/)
    const before = await button.boundingBox()

    await button.click()

    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(button).toHaveAttribute('data-state', 'loading')
    await expect(button).toContainText('模拟提交')
    await expect(button.locator('[data-kit-button-spinner]')).toBeVisible()
    await button.click({ force: true })
    await expect(counter).toHaveText('提交调用次数：1')

    const during = await button.boundingBox()
    expect(during?.width).toBeCloseTo(before?.width ?? 0, 0)

    await expect(button).toBeEnabled({ timeout: 3_000 })
    await expect(button).toHaveAttribute('data-state', 'default')
  })

  test('显式 success 缩为勾后约一秒复位', async ({ page }) => {
    const button = page.getByRole('button', { name: '原地保存', exact: true })

    await button.click()
    await expect(button).toHaveAttribute('data-state', 'loading')
    await expect(button).toHaveAttribute('data-state', 'success', { timeout: 3_000 })
    await expect(button.locator('[data-kit-button-check]')).toBeVisible()
    await expect(button).toHaveAttribute('data-state', 'default', { timeout: 3_000 })
    await expect(button).toContainText('原地保存')
  })
})
