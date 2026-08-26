import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

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

async function openProjectList(page: Page) {
  const response = page.waitForResponse(candidate =>
    candidate.url().includes('/api/read/projects')
    && candidate.url().includes('includeDemo=true')
    && candidate.request().method() === 'GET',
  )
  await page.goto('/project')
  expect((await response).ok()).toBe(true)
  return page.getByRole('link', { name: '合和新城', exact: true }).first()
}

test.describe('Issue #312：项目 Target Registry', () => {
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

  test('中央语义目标生成稳定详情链接，点击与刷新都保持同一身份', async ({ page }) => {
    const projectLink = await openProjectList(page)
    await expect(projectLink).toBeVisible({ timeout: 20_000 })
    const href = await projectLink.getAttribute('href')
    expect(href).not.toBeNull()
    const target = new URL(href!, 'http://localhost')
    const returnContext = target.searchParams.get('returnContext')
    expect(target.pathname).toBe('/project/proj_demo_001')
    expect(target.searchParams.get('origin')).toBe('demo')
    expect(returnContext).toMatch(/^origin_[\w-]+$/)
    expect(target.searchParams.get('returnTo'))
      .toBe(`/project?nav=${returnContext}#project-row-demo%3Aproj_demo_001`)

    await projectLink.click()
    await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`)
      .toBe(href)
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()
    await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()

    await page.reload()
    await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).search}`)
      .toBe(href)
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()
  })

  test('错误来源与缺失身份分别呈现稳定空态，不按名称回退', async ({ page }) => {
    await page.goto('/project/proj_demo_001?origin=real')
    await expect(page.getByRole('status', { name: '项目身份与来源不匹配' }))
      .toContainText('项目存在，但 URL 来源与中央身份不一致')
    await expect(page.getByRole('heading', { name: '合和新城', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '返回项目列表' })).toHaveAttribute('href', '/project')

    await page.goto('/project/__missing_project__?origin=demo')
    await expect(page.getByRole('status', { name: '项目不存在或当前来源不可见' }))
      .toBeVisible()
    await expect(page.getByRole('heading', { name: '合和新城', exact: true })).toHaveCount(0)
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 详情目标不产生页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/project/proj_demo_001?origin=demo')
      await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
        .toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#312 项目详情目标 @ ${width}px`)
    })
  }
})
