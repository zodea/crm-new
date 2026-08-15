import type { TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectInViewport, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

test.describe('Issue #185：项目页面状态与恢复旅程', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await page.context().request.post('/api/testing/projects/reset', {
      data: { scenario: 'ready' },
      headers: {
        'x-ruihang-test-reset': '1',
        'x-ruihang-test-session': sessionId,
      },
    })
  })

  test.afterEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.context().request.post('/api/testing/projects/reset', {
      data: { scenario: 'ready' },
      headers: {
        'x-ruihang-test-reset': '1',
        'x-ruihang-test-session': sessionId,
      },
    })
  })

  test('真实项目列表覆盖默认、加载、错误与重试', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    const reset = (scenario: 'ready' | 'unavailable') => page.context().request.post(
      '/api/testing/projects/reset',
      {
        data: { scenario },
        headers: {
          'x-ruihang-test-reset': '1',
          'x-ruihang-test-session': sessionId,
        },
      },
    )

    await page.route('**/api/read/projects**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 350))
      await route.continue()
    })
    await page.goto('/project', { waitUntil: 'commit' })
    await expect(page.getByRole('status', { name: '正在加载项目列表' }))
      .toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.vxe-body--row').first()).toBeVisible({ timeout: 15_000 })

    await reset('unavailable')
    await page.getByRole('button', { name: '刷新项目列表' }).click()

    const error = page.getByRole('alert', { name: '项目列表加载失败' })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(error).toContainText('中央后台测试实例暂时不可用')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()

    await reset('ready')
    await error.getByRole('button', { name: '重新加载' }).click()
    await expect(error).toBeHidden()
    await expect(page.locator('.vxe-body--row').first()).toBeVisible({ timeout: 15_000 })
  })

  test('清除组合筛选时同步恢复全部阶段与空搜索', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/project')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()

    const phaseNavigation = page.getByRole('navigation', { name: '列表分类' })
    const allProjects = phaseNavigation.getByRole('button', { name: /全部项目/ })
    const construction = phaseNavigation.getByRole('button', { name: /施工中/ })
    await construction.click()
    await expect(construction).toHaveClass(/bg-brand-soft/)

    const search = page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })
    await search.fill('__no_matching_project__')
    const empty = page.getByRole('status', { name: '没有符合条件的项目' })
    await empty.getByRole('button', { name: '清除筛选' }).click()

    await expect(search).toHaveValue('')
    await expect(allProjects).toHaveClass(/bg-brand-soft/)
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`列表筛选空态可通过键盘清除并恢复 @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/project')
      await page.waitForLoadState('networkidle')

      const search = page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })
      await expect(search).toBeVisible({ timeout: 15_000 })
      await search.fill('__no_matching_project__')

      const empty = page.getByRole('status', { name: '没有符合条件的项目' })
      await expect(empty).toBeVisible()
      await expect(empty).toContainText('可清除搜索、状态和表头筛选后查看全部项目。')

      const clear = empty.getByRole('button', { name: '清除筛选' })
      await expectInViewport(clear, `项目列表空态主操作 @ ${width}px`)
      await clear.focus()
      await expect(clear).toBeFocused()
      await page.keyboard.press('Enter')

      await expect(search).toHaveValue('')
      await expect(page.locator('.vxe-body--row').first()).toBeVisible()
      await expectNoPageOverflow(page, `项目列表恢复态 @ ${width}px`)
    })

    test(`详情缺失态可通过键盘返回列表 @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await page.goto('/project/__missing_project__')
      await page.waitForLoadState('networkidle')

      const empty = page.getByRole('status', { name: '项目不存在或已被删除' })
      await expect(empty).toBeVisible()
      await expect(empty).toContainText('该项目可能已在别处被删除，可返回项目列表查看。')

      const back = empty.getByRole('link', { name: '返回项目列表' })
      await expectInViewport(back, `项目详情缺失态返回入口 @ ${width}px`)
      await back.focus()
      await expect(back).toBeFocused()
      await page.keyboard.press('Enter')

      await expect(page).toHaveURL(/\/project$/)
      await expect(page.getByRole('heading', { name: '施工项目' })).toBeVisible()
      await expectNoPageOverflow(page, `项目详情缺失态 @ ${width}px`)
    })
  }
})
