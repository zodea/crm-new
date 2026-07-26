import { expect, test } from '@playwright/test'

test.describe('LookupSelect 检索下拉原语', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/kit-ui')
    await expect(page.getByRole('combobox', { name: '搜索项目' })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('支持防抖检索、高亮、键盘选择与最近选择清理', async ({ page }) => {
    const lookup = page.getByRole('combobox', { name: '搜索项目' })
    await lookup.fill('车')

    const option = page.getByRole('option', { name: /车陂全流程项目/ })
    await expect(option).toBeVisible({ timeout: 3_000 })
    await expect(option.locator('mark')).toHaveText('车')

    await page.keyboard.press('Escape')
    await expect(option).toBeHidden()
    await lookup.click()
    await expect(option).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByText('当前选中 ID：project-chebei')).toBeVisible()

    await lookup.click()
    await expect(page.getByText('最近选择', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '不再显示' }).click()
    await expect(page.getByText('最近选择', { exact: true })).toBeHidden()
  })

  test('依赖未满足时提示原因且不打开浮层', async ({ page }) => {
    const lookup = page.getByRole('combobox', { name: '搜索合同' })
    const reason = '该字段依赖“项目名称”的值，请补全后操作'
    await page.getByRole('button', { name: reason }).click()

    await expect(lookup).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText(reason)).toBeVisible()
  })
})
