import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'demo-forbidden' | 'unavailable'

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function testSession(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetProjectBackend(
  request: APIRequestContext,
  scenario: Scenario,
  sessionId: string,
) {
  const response = await request.post('/api/testing/projects/reset', {
    headers: {
      'x-ruihang-test-reset': '1',
      'x-ruihang-test-session': sessionId,
    },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

async function openProjectList(page: Page) {
  const response = page.waitForResponse(candidate =>
    candidate.url().includes('/api/read/projects') && candidate.request().method() === 'GET',
  )
  await page.goto('/project')
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('link', { name: '合和新城', exact: true }).first())
    .toBeVisible({ timeout: 15_000 })
}

test.describe('Issue #288：项目列表中央 HTTP 读链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.addInitScript((storageKey) => {
      localStorage.setItem(storageKey, 'true')
    }, DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetProjectBackend(page.context().request, 'ready', sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await resetProjectBackend(page.context().request, 'ready', sessionId)
  })

  test('真实应用壳穿过 Repository 与 HTTP，保留 0/null/权限语义', async ({ page }) => {
    const readRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/read/projects'))
        readRequests.push(request.url())
    })

    await openProjectList(page)

    expect(readRequests).toHaveLength(1)
    expect(readRequests[0]).toContain('page=1')
    expect(readRequests[0]).toContain('pageSize=10')
    expect(readRequests[0]).toContain('includeDemo=true')
    await expect(page.getByLabel('项目来源数量')).toContainText('测试 12 个')
    await expect(page.getByText('无权限', { exact: true })).toBeVisible()
    await expect(page.getByText('翠湖投资', { exact: true })).toHaveCount(0)
    await expect(page.getByText('¥0.00', { exact: true }).first()).toBeVisible()

    const summary = page.getByLabel('项目列表汇总')
    await expect(summary).toContainText(/测试数据.*累计收入\s*—.*收入缺失 10 个/)
    await expect(summary).toContainText(/测试数据.*预算总额\s*—.*预算缺失 10 个/)
    await expect(page.getByRole('button', { name: '新增项目' })).toBeEnabled()
    await expect(page.getByRole('button', { name: '导入项目', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '导入项目', exact: true })).toHaveAttribute('title', '导入项目（映射页签）')
  })

  test('刷新失败保留 previous，重试后恢复', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await openProjectList(page)
    await resetProjectBackend(page.context().request, 'unavailable', sessionId)
    await page.getByRole('button', { name: '刷新项目列表' }).click()

    const error = page.getByRole('alert', { name: '项目列表加载失败' })
    await expect(error).toContainText('中央后台测试实例暂时不可用')
    await expect(page.getByRole('link', { name: '合和新城', exact: true }).first()).toBeVisible()

    await resetProjectBackend(page.context().request, 'ready', sessionId)
    await error.getByRole('button', { name: '重新加载' }).click()
    await expect(error).toBeHidden()
    await expect(page.getByRole('link', { name: '合和新城', exact: true }).first()).toBeVisible()
  })

  test('无权限不伪装成空列表', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await openProjectList(page)
    await resetProjectBackend(page.context().request, 'forbidden', sessionId)
    await page.getByRole('button', { name: '刷新项目列表' }).click()

    await expect(page.getByRole('status', { name: '无项目查看权限' })).toBeVisible()
    await expect(page.getByText('还没有施工项目')).toHaveCount(0)
  })

  test('列头筛选覆盖完整快照，并能命中首屏之外的项目', async ({ page }) => {
    await openProjectList(page)

    const tableScroller = page.locator('[data-ui="kit-table"] .vxe-table--scroll-x-handle').first()
    await tableScroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    const customerHeader = page.getByRole('columnheader', { name: /^客户/ }).first()
    await expect.poll(async () => (await customerHeader.boundingBox())?.x ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(1_200)
    await customerHeader.locator('.vxe-filter--btn').click()

    const filterPanel = page.locator('.vxe-table--filter-wrapper.is--active')
    await expect(filterPanel.getByText('广州市政集团', { exact: true })).toBeVisible()

    const response = page.waitForResponse(candidate =>
      candidate.url().includes('/api/read/projects')
      && candidate.url().includes('filterCustomerIds')
      && candidate.request().method() === 'GET',
    )
    await filterPanel.getByText('广州市政集团', { exact: true }).click()
    await filterPanel.getByText('筛选', { exact: true }).click()
    expect((await response).ok()).toBe(true)

    await expect(page.getByRole('link', { name: '零星维修框架项目', exact: true })).toBeVisible()
    await expect(page.getByLabel('项目来源数量')).toContainText('测试 1 个')
    await expect(page.getByLabel('项目列表汇总')).toContainText(/测试数据\s*1 个/)
  })

  test('中央实例真实无记录时显示 no-records，而非筛选空态', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await resetProjectBackend(page.context().request, 'empty', sessionId)

    const response = page.waitForResponse(candidate =>
      candidate.url().includes('/api/read/projects') && candidate.request().method() === 'GET',
    )
    await page.goto('/project')
    expect((await response).ok()).toBe(true)

    await expect(page.getByRole('status', { name: '还没有施工项目' })).toBeVisible()
    await expect(page.getByRole('status', { name: '没有符合条件的项目' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '合和新城', exact: true })).toHaveCount(0)
  })
})
