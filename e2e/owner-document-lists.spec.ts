import { expect, test } from '@playwright/test'

const LIST_ROUTES = [
  { path: '/owner/change', typeFilter: true },
  { path: '/owner/report', typeFilter: false },
  { path: '/owner/acceptance', typeFilter: true },
  { path: '/owner/final-settlement', typeFilter: false },
  { path: '/owner/penalty', typeFilter: false },
  { path: '/subcontract/change', typeFilter: true },
  { path: '/subcontract/settlement', typeFilter: true },
  { path: '/project/penalty', typeFilter: false },
] as const

for (const width of [390, 768, 1024, 1440]) {
  test.describe(`${width}px 单据列表`, () => {
    for (const item of LIST_ROUTES) {
      test(`${item.path} 使用统一工具栏、分页表格且页面不横向溢出`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await page.goto(item.path)

        await expect(page.locator('[data-ui="owner-document-list-toolbar"]')).toBeVisible({
          timeout: 60_000,
        })
        await expect(page.getByRole('combobox', { name: '项目' })).toBeVisible()
        await expect(page.getByRole('combobox', { name: '状态' })).toBeVisible()
        if (item.typeFilter)
          await expect(page.getByRole('combobox', { name: /类型/ })).toBeVisible()
        await expect(page.locator('[data-ui="owner-document-table"]')).toBeVisible()

        const overflow = await page.evaluate(() => ({
          body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          table: (() => {
            const table = document.querySelector<HTMLElement>('[data-ui="owner-document-table"]')
            return table ? table.scrollWidth - table.clientWidth : 0
          })(),
        }))
        expect(overflow.body).toBeLessThanOrEqual(1)
        if (width === 390) {
          expect(overflow.table).toBeGreaterThan(0)
          const table = page.locator('[data-ui="owner-document-table"]')
          await table.focus()
          await page.keyboard.press('ArrowRight')
          await expect.poll(() => table.evaluate(element => element.scrollLeft))
            .toBeGreaterThan(0)
        }
      })
    }
  })
}

test('来源 query 显示可清除范围且筛选空态可恢复', async ({ page }) => {
  await page.goto('/owner/change?project=e2e-missing-project')

  const context = page.locator('[data-ui="owner-document-route-context"]')
  await expect(context).toBeVisible()
  await expect(context).toContainText('项目：e2e-missing-project')
  await context.getByRole('button', { name: /清除项目/ }).click()
  await expect(page).toHaveURL('/owner/change')
})
