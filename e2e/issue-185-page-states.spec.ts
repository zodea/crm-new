import type { TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import { expectInViewport, expectNoPageOverflow } from './helpers/responsive'

const VIEWPORT_WIDTHS = [390, 768, 1024, 1280, 1440] as const
const VIEWPORT_HEIGHTS: Record<(typeof VIEWPORT_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1280: 900,
  1440: 1000,
}

const sessionIds = new Map<string, string>()

function testSession(testInfo: TestInfo) {
  if (!sessionIds.has(testInfo.testId))
    sessionIds.set(testInfo.testId, `${Buffer.from(testInfo.testId, 'utf8').toString('base64url')}-${randomUUID()}`)
  return sessionIds.get(testInfo.testId)!
}

test.describe('Issue #185：项目页面状态与恢复旅程', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    const reset = await page.context().request.post('/api/testing/projects/reset', {
      data: { scenario: 'ready' },
      headers: {
        'x-ruihang-test-reset': '1',
        'x-ruihang-test-session': sessionId,
      },
    })
    expect(reset.ok()).toBe(true)
    await installProjectCentralFixture(page, PROJECT_INPUTS[1], { sessionId })
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

  test('真实项目列表覆盖默认、加载、错误与重试', async ({ page }) => {
    let unavailable = false
    let release!: () => void
    const loading = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstRead = true
    await page.route('**/api/read/projects?*', async (route) => {
      if (unavailable) {
        await route.fulfill({ status: 503, json: { data: { code: 'unavailable', message: '中央后台测试实例暂时不可用', retryable: true, fieldErrors: {}, traceId: null } } })
        return
      }
      if (firstRead) {
        firstRead = false
        await loading
      }
      await route.continue()
    })
    await page.goto('/project', { waitUntil: 'commit' })
    await expect(page.getByRole('status', { name: '正在加载项目列表' }))
      .toBeVisible({ timeout: 15_000 })
    release()
    await expect(page.getByRole('link', { name: PROJECT_INPUTS[1].name, exact: true }).first()).toBeVisible({ timeout: 15_000 })

    unavailable = true
    await page.getByRole('button', { name: '刷新项目列表' }).click()

    const error = page.getByRole('alert', { name: '项目列表加载失败' })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(error).toContainText('中央后台测试实例暂时不可用')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()

    unavailable = false
    await error.getByRole('button', { name: '重新加载' }).click()
    await expect(error).toBeHidden()
    await expect(page.locator('.vxe-body--row').first()).toBeVisible({ timeout: 15_000 })
  })

  test('清除组合筛选时同步恢复全部阶段与空搜索', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/project')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()

    const phaseNavigation = page.getByRole('navigation', { name: '列表分类' })
    const construction = phaseNavigation.getByRole('button', { name: /施工中/ })
    const filtered = page.waitForRequest(request => new URL(request.url()).pathname === '/api/read/projects' && new URL(request.url()).searchParams.get('status') === '施工中')
    await construction.click()
    await filtered
    await expect(page.getByRole('link', { name: PROJECT_INPUTS[1].name, exact: true }).first()).toBeVisible()

    const search = page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })
    await search.fill('__no_matching_project__')
    const empty = page.getByRole('status', { name: '没有符合条件的项目' })
    const cleared = page.waitForRequest(request => new URL(request.url()).pathname === '/api/read/projects' && !new URL(request.url()).searchParams.get('status') && !new URL(request.url()).searchParams.get('search'))
    await empty.getByRole('button', { name: '清除筛选' }).click()
    await cleared

    await expect(search).toHaveValue('')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()
  })

  test('列表筛选空态可通过键盘清除并恢复，各宽度入口可达', async ({ page }) => {
    await page.goto('/project')
    await page.waitForLoadState('networkidle')

    const search = page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })
    await expect(search).toBeVisible({ timeout: 15_000 })
    await search.fill('__no_matching_project__')

    const empty = page.getByRole('status', { name: '没有符合条件的项目' })
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('可清除搜索、状态和表头筛选后查看全部项目。')

    const clear = empty.getByRole('button', { name: '清除筛选' })
    for (const width of VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await expectInViewport(clear, `项目列表空态主操作 @ ${width}px`)
    }
    await clear.focus()
    await expect(clear).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(search).toHaveValue('')
    await expect(page.locator('.vxe-body--row').first()).toBeVisible()
    for (const width of VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await expectNoPageOverflow(page, `项目列表恢复态 @ ${width}px`)
    }
  })

  test('详情缺失态可通过键盘返回列表，各宽度入口可达', async ({ page }) => {
    await page.goto('/project/__missing_project__?origin=real')
    await page.waitForLoadState('networkidle')

    const empty = page.getByRole('status', { name: '项目不存在或当前来源不可见' })
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('请确认测试数据开关与来源后返回项目列表重试。')

    const back = empty.getByRole('link', { name: '返回项目列表' })
    for (const width of VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHTS[width] })
      await expectInViewport(back, `项目详情缺失态返回入口 @ ${width}px`)
      await expectNoPageOverflow(page, `项目详情缺失态 @ ${width}px`)
    }
    await back.focus()
    await expect(back).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/project$/)
    await expect(page.getByRole('heading', { name: '项目列表', exact: true })).toBeVisible()
  })
})
