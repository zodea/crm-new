import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
] as const

async function expectNoDocumentOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    rootClient: document.documentElement.clientWidth,
    rootScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
  }))
  expect(widths.rootScroll).toBeLessThanOrEqual(widths.rootClient)
  expect(widths.bodyScroll).toBeLessThanOrEqual(widths.viewport)
}

async function createRealStatementAndOpenDetail(page: Page) {
  await page.goto('/subcontract/payroll')
  await expect(page.getByRole('heading', { name: '工资核算' }).last()).toBeVisible({ timeout: 20_000 })
  const toolbar = page.getByLabel('工资筛选与建单').locator(':scope > div').first()
  await toolbar.locator('select').first().selectOption('proj_demo_001')
  await toolbar.locator('input[type="month"]').fill('2026-07')
  await page.getByRole('button', { name: '生成月度草稿' }).click()
  await page.getByLabel('建单项目').selectOption('proj_demo_001')
  await page.getByLabel('责任班组').selectOption('crew_demo_006')
  await page.getByLabel('请款负责人').selectOption('wkr_demo_007')
  await page.getByLabel('工资取数口径').selectOption('field')
  await page.getByRole('button', { name: '确认生成草稿' }).click()

  const detail = page.getByRole('region', { name: '工资单列表' }).getByRole('link', { name: '详情' }).first()
  await expect(detail).toBeVisible({ timeout: 20_000 })
  await detail.click()
  await expect(page.getByRole('heading', { name: '周伟峰请款簿' })).toBeVisible({ timeout: 20_000 })
}

test.describe('Issue #197：请款簿独立详情', () => {
  test('真实工资单详情区分核算金额与正式已发，并完成四档布局回归', async ({ page }) => {
    await createRealStatementAndOpenDetail(page)

    const formalPaid = page.getByRole('group', { name: '正式已发' })
    await expect(formalPaid).toContainText('¥0.00')
    await expect(page.getByText('当前按暂估量预核')).toHaveCount(0)
    await expect(page.getByRole('region', { name: '工资核算明细' })).toBeVisible()
    await expect(page.getByRole('region', { name: '工资单成员与实际分配' })).toBeVisible()
    await expect(page.getByRole('button', { name: /核对|发放|删除|编辑/ })).toHaveCount(0)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport)
      await expectNoDocumentOverflow(page)

      const detailLink = page.getByRole('link', { name: '返回工资核算' })
      await detailLink.focus()
      await expect(detailLink).toBeFocused()

      if (viewport.width <= 768) {
        const hasLocalScroller = await page
          .getByRole('region', { name: '工资核算明细' })
          .evaluate(root =>
            Array.from(root.querySelectorAll<HTMLElement>('*')).some((element) => {
              const style = getComputedStyle(element)
              return element.scrollWidth > element.clientWidth + 1
                && /auto|scroll/.test(style.overflowX)
            }),
          )
        expect(hasLocalScroller).toBe(true)
      }
    }
  })

  test('删除或不存在的工资单显示明确空态', async ({ page }) => {
    await page.goto('/subcontract/payroll/not-a-real-statement')
    await expect(page.getByText('请款簿不存在或已删除')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '返回工资核算' })).toBeVisible()
  })
})
