import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

test.describe('Issue #194：工人详情', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `worker-detail-${randomUUID()}` })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    const response = await page.request.post('/api/testing/crew-workers/reset', { headers: { 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
    expect(response.ok(), await response.text()).toBe(true)
  })
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示演示个人、班组和项目责任且页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/base/worker/wkr_demo_003?origin=demo')

      const shell = page.locator('[data-ui="entity-detail-shell"]')
      await expect(shell.getByRole('heading', { name: '张建国' }))
        .toBeVisible({ timeout: 15_000 })
      await expect(shell.getByRole('link', { name: '返回工人列表' }))
        .toHaveAttribute('href', '/base/worker')
      await expect(shell.getByText('泥水A班', { exact: true }).first()).toBeVisible()
      await expect(shell.getByText('工人主档', { exact: true })).toBeVisible()
      await expect(shell.getByText('测试档案只读', { exact: true })).toBeVisible()
      await expect(shell.getByRole('link', { name: '编辑', exact: true })).toHaveCount(0)
      await expect(shell.getByText('135 **** 0003', { exact: true }).first()).toBeVisible()
      await expect(shell.getByText('3624 **** 6789', { exact: true })).toBeVisible()
      await expect(shell.getByText('13511220003', { exact: true })).toHaveCount(0)
      await expect(shell.getByText('362426198712146789', { exact: true })).toHaveCount(0)
      await expect(shell.getByText('项目与责任单元', { exact: true })).toBeVisible()
      await expect(shell.getByText('扣罚事实', { exact: true })).toBeVisible()
      await expectNoPageOverflow(page, `工人详情 @ ${width}px`)
    })
  }

  test('窄窗责任单元表只在自身区域横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/base/worker/wkr_demo_003?origin=demo')

    await expectLocalHorizontalScroll(
      page.locator('section').filter({ has: page.getByText('项目与责任单元', { exact: true }) }).locator('div.overflow-x-auto'),
      '工人责任单元表',
    )
    await expectNoPageOverflow(page, '工人详情窄窗')
  })

  test('不存在的工人保留返回入口且不显示无效重试操作', async ({ page }) => {
    await page.goto('/base/worker/not-exists')

    await expect(page.getByRole('status', { name: '工人不存在或来源不匹配' })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回工人列表' }))
      .toHaveAttribute('href', '/base/worker')
    await expect(page.getByRole('button', { name: '重新加载' })).toHaveCount(0)
  })
})
