import { expect, test } from '@playwright/test'

test.describe('FormFooter 表单保存动作组', () => {
  test('联动 dirty、保存后关闭和提交 loading', async ({ page }) => {
    await page.goto('/dev/kit-ui')

    const footer = page.getByRole('group', { name: '表单操作' })
    await expect(footer).toBeVisible({ timeout: 20_000 })
    const draft = footer.getByRole('button', { name: '保存草稿' })
    const submit = footer.getByRole('button', { name: '保存并提交' })

    await expect(draft).toBeDisabled()
    await page.getByRole('checkbox', { name: '表单有修改（dirty）' }).check()
    await expect(draft).toBeEnabled()

    await footer.getByRole('checkbox', { name: '【保存】后关闭' }).check()
    await expect(page.getByText('dirty：true；保存后关闭：true')).toBeVisible()

    await submit.click()
    await expect(submit).toHaveAttribute('data-state', 'loading')
    for (const button of await footer.getByRole('button').all())
      await expect(button).toBeDisabled()

    await expect(submit).toHaveAttribute('data-state', 'default', { timeout: 3_000 })
    await expect(page.getByText(/FormFooter action：saveSubmit；保存后关闭：true/)).toBeVisible()
  })

  test('在 390px 视口换行且不造成页面横向溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/kit-ui')
    await expect(page.getByRole('group', { name: '表单操作' })).toBeVisible({
      timeout: 20_000,
    })

    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(widths.scroll).toBeLessThanOrEqual(widths.client)
  })
})
