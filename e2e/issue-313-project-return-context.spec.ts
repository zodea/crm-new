import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetProjectBackend(request: APIRequestContext, sessionId: string) {
  const response = await request.post('/api/testing/projects/reset', {
    headers: {
      'x-ruihang-test-reset': '1',
      'x-ruihang-test-session': sessionId,
    },
    data: { scenario: 'ready' },
  })
  expect(response.ok()).toBe(true)
}

async function openProjectList(page: Page, target = '/project') {
  const response = page.waitForResponse(candidate =>
    candidate.url().includes('/api/read/projects')
    && candidate.url().includes('includeDemo=true')
    && candidate.request().method() === 'GET',
  )
  await page.goto(target)
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('link', { name: '合和新城', exact: true }).first())
    .toBeVisible({ timeout: 20_000 })
}

test.describe('Issue #313：项目列表完整来源上下文', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.addInitScript((storageKey) => {
      localStorage.setItem(storageKey, 'true')
    }, DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetProjectBackend(page.context().request, sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    await resetProjectBackend(page.context().request, testSession(testInfo))
  })

  test('详情刷新后仍恢复筛选、排序、应用页签、滚动和焦点', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 500 })
    await openProjectList(page)

    await page.getByRole('searchbox', { name: '搜索项目、客户、经理…' }).fill('合和')
    await page.getByRole('button', { name: '施工中' }).click()
    await page.getByRole('button', { name: '切换项目排序' }).click()

    const projectLink = page.getByRole('link', { name: '合和新城', exact: true }).first()
    const workspace = page.locator('[data-shell-workspace]')
    await expect(projectLink).toBeVisible()
    await projectLink.focus()
    const capturedScroll = await workspace.evaluate((element) => {
      element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight)
      return element.scrollTop
    })
    expect(capturedScroll).toBeGreaterThan(0)
    await projectLink.press('Enter')

    await expect(page).toHaveURL(/\/project\/proj_demo_001\?origin=demo&returnTo=.*&returnContext=/)
    await expect(page.getByRole('heading', { name: '合和新城', exact: true })).toBeVisible()
    await page.reload()
    const returnLink = page.getByRole('link', { name: '返回项目列表' })
    await expect(returnLink).toBeVisible()
    await returnLink.focus()
    await expect(returnLink).toBeFocused()
    await returnLink.press('Enter')

    await expect(page).toHaveURL(/\/project\?.*search=%E5%90%88%E5%92%8C.*phase=%E6%96%BD%E5%B7%A5%E4%B8%AD.*sort=name-asc.*#project-row-demo%3Aproj_demo_001$/)
    await expect(page.getByRole('searchbox', { name: '搜索项目、客户、经理…' })).toHaveValue('合和')
    await expect(page.getByRole('button', { name: '施工中' })).toHaveClass(/bg-brand-soft/)
    await expect(page.getByRole('button', { name: '切换项目排序' }))
      .toHaveAttribute('title', /当前按项目名称排序/)
    await expect(projectLink).toBeFocused()
    await expect(workspace).toHaveJSProperty('scrollTop', capturedScroll)
    await expect(page.locator('[data-tab-trigger][aria-current="page"]').filter({ hasText: '项目列表' }))
      .toBeVisible()
  })

  test('直达详情或伪造外部来源只返回规范项目列表', async ({ page }) => {
    await page.goto('/project/proj_demo_001?origin=demo&returnTo=https%3A%2F%2Fevil.example&returnContext=prc_forged')
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '返回项目列表' })).toHaveAttribute('href', '/project')
  })

  test('恢复非默认页码、每页条数与列筛选', async ({ page }) => {
    await openProjectList(page)
    await page.getByRole('button', { name: '第 2 页' }).click()
    await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
    const pageTwoRow = page.locator('[id^="project-row-"] > a').first()
    const pageTwoName = (await pageTwoRow.textContent())!.trim()
    await pageTwoRow.click()
    await expect(page.getByRole('heading', { name: pageTwoName, exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page).toHaveURL(/\/project\?.*page=2.*#project-row-/)
    await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: pageTwoName, exact: true }).first()).toBeFocused()

    await openProjectList(page, '/project?pageSize=20&status=%E6%96%BD%E5%B7%A5%E4%B8%AD')
    await expect(page.getByRole('combobox', { name: '每页条数' })).toHaveValue('20')
    const filteredRow = page.locator('[id^="project-row-"] > a').first()
    const filteredName = (await filteredRow.textContent())!.trim()
    await filteredRow.click()
    await expect(page.getByRole('heading', { name: filteredName, exact: true })).toBeVisible()
    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page).toHaveURL(/\/project\?.*pageSize=20.*status=%E6%96%BD%E5%B7%A5%E4%B8%AD.*#project-row-/)
    await expect(page.getByRole('combobox', { name: '每页条数' })).toHaveValue('20')
    await expect(page.getByRole('link', { name: filteredName, exact: true }).first()).toBeFocused()
  })
})
