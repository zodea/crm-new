import { expect, test } from '@playwright/test'

test.describe('侧栏一级目录单开模式', () => {
  test('打开新目录时自动收起前一个，路由变化后展开所属目录', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem('ruihang-sidebar-pinned', 'true')
    })
    await page.goto('/settings/ocr')
    await expect(page.getByTestId('ocr-settings-page')).toBeVisible({ timeout: 30_000 })

    const settings = page.getByRole('button', { name: '设置', exact: true })
    const finance = page.getByRole('button', { name: '资金管理', exact: true })
    const material = page.getByRole('button', { name: '乙供材管理', exact: true })

    await expect(settings).toHaveAttribute('aria-expanded', 'true')
    await finance.click()
    await expect(finance).toHaveAttribute('aria-expanded', 'true')
    await expect(settings).toHaveAttribute('aria-expanded', 'false')

    await material.click()
    await expect(material).toHaveAttribute('aria-expanded', 'true')
    await expect(finance).toHaveAttribute('aria-expanded', 'false')

    await page.getByRole('link', { name: /送货单识别/ }).click()
    await expect(page).toHaveURL(/\/material\/delivery/)
    await expect(material).toHaveAttribute('aria-expanded', 'true')
  })
})
