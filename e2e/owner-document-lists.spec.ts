import { expect, test } from '@playwright/test'

const LIST_ROUTES = [
  { path: '/owner/change', typeFilter: true },
  { path: '/owner/report', typeFilter: false },
  { path: '/owner/acceptance', typeFilter: false },
  { path: '/owner/final-settlement', typeFilter: false },
  { path: '/owner/penalty', typeFilter: false },
  { path: '/subcontract/change', typeFilter: true },
  { path: '/subcontract/settlement', typeFilter: true },
  { path: '/project/penalty', typeFilter: false },
] as const

for (const item of LIST_ROUTES) {
  test(`${item.path} 使用统一工具栏、分页表格，各宽度页面不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(item.path)

    await expect(page.locator('[data-ui="owner-document-list-toolbar"]')).toBeVisible({
      timeout: 60_000,
    })
    const table = page.locator('[data-ui="owner-document-table"]')
    await expect(table).toBeVisible()
    await expect(table).toHaveAttribute('aria-busy', 'false')

    const tableOverflow = await table.evaluate(element => element.scrollWidth - element.clientWidth)
    if (tableOverflow > 0) {
      await table.focus()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => table.evaluate(element => element.scrollLeft))
        .toBeGreaterThan(0)
    }
    else {
      // vxe 布局完成后可由内部主体接管横滚，仍必须局限在表格中。
      await expect.poll(() => table.locator('.vxe-table--scroll-x-handle').evaluateAll(elements =>
        elements.some(element => element.scrollWidth > element.clientWidth),
      )).toBe(true)
      const scrollbar = table.locator('.vxe-table--scroll-x-handle')
      await scrollbar.evaluate(element => element.scrollLeft = 120)
      await expect.poll(() => scrollbar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }

    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expect(page.getByRole('combobox', { name: '项目' })).toBeVisible()
      await expect(page.getByRole('button', { name: /^状态，已选/ })).toBeVisible()
      if (item.typeFilter)
        await expect(page.getByRole('button', { name: /类型，已选/ })).toBeVisible()
      const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(bodyOverflow, `${item.path} @ ${width}px 页面级横向溢出`).toBeLessThanOrEqual(1)
    }
  })
}

for (const projectId of ['e2e-missing-project', 'e2e-missing-project-with-long-identity']) {
  test(`来源 query 显示可清除范围且筛选空态可恢复：${projectId}`, async ({ page }) => {
    await page.goto(`/owner/change?projectId=${projectId}`)

    const context = page.locator('[data-ui="owner-document-route-context"]')
    await expect(context).toBeVisible()
    await expect(context).toContainText(`项目：${projectId}`)
    await context.getByRole('button', { name: /清除项目/ }).click()
    await expect(page).toHaveURL('/owner/change')
  })
}
