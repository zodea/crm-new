import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

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

async function openProductionOnlyList(page: Page) {
  const response = page.waitForResponse(candidate =>
    candidate.url().includes('/api/read/projects')
    && candidate.url().includes('includeDemo=false')
    && candidate.request().method() === 'GET',
  )
  await page.goto('/project')
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('status', { name: '还没有施工项目' })).toBeVisible()
}

async function includeDemo(page: Page) {
  const response = page.waitForResponse(candidate =>
    candidate.url().includes('/api/read/projects')
    && candidate.url().includes('includeDemo=true')
    && candidate.request().method() === 'GET',
  )
  await page.getByRole('button', { name: '包含测试数据' }).click()
  await page.getByRole('button', { name: '确认切换' }).click()
  expect((await response).ok()).toBe(true)
  await expect(page.getByRole('link', { name: '合和新城', exact: true }).first()).toBeVisible()
}

test.describe('Issue #279：正式与演示数据边界', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    await resetProjectBackend(page.context().request, 'ready', sessionId)
  })

  test.afterEach(async ({ page }, testInfo) => {
    await resetProjectBackend(page.context().request, 'ready', testSession(testInfo))
  })

  test('默认关闭，开启后持续标识和分组汇总，再关闭恢复正式空态', async ({ page }) => {
    await openProductionOnlyList(page)
    await expect(page.getByRole('button', { name: '包含测试数据' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('link', { name: '合和新城', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('项目列表汇总')).toContainText(/正式数据\s*当前筛选范围\s*0 个/)

    await includeDemo(page)
    await expect(page.getByRole('button', { name: '关闭测试数据' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('项目列表汇总')).toContainText(/正式数据\s*当前筛选范围\s*0 个/)
    await expect(page.getByLabel('项目列表汇总')).toContainText(/测试数据\s*当前筛选范围\s*12 个/)
    await expect(page.getByText('测试数据', { exact: true }).first()).toBeVisible()
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), DATA_VISIBILITY_STORAGE_KEY)).toBe('true')

    await page.getByRole('link', { name: '合和新城', exact: true }).first().click()
    await expect(page).toHaveURL(/\/project\/proj_demo_001\?origin=demo(?:&|$)/)
    await expect(page.getByRole('status', { name: '测试数据只读详情' })).toContainText('测试数据仅供查看')
    await expect(page.getByRole('heading', { name: '合和新城' })).toBeFocused()
    await expect(page.getByRole('link', { name: '编辑项目' })).toHaveCount(0)

    await page.getByRole('link', { name: '返回项目列表' }).click()
    await expect(page.getByRole('button', { name: '关闭测试数据' })).toHaveAttribute('aria-pressed', 'true')
    const response = page.waitForResponse(candidate =>
      candidate.url().includes('/api/read/projects')
      && candidate.url().includes('includeDemo=false'),
    )
    await page.getByRole('button', { name: '关闭测试数据' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    expect((await response).ok()).toBe(true)
    await expect(page.getByRole('status', { name: '还没有施工项目' })).toBeVisible()
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), DATA_VISIBILITY_STORAGE_KEY)).toBe('false')
  })

  test('同名正式项目与测试项目在列表中保持独立身份、权限和汇总', async ({ page }) => {
    test.setTimeout(90_000)
    await openProductionOnlyList(page)
    await page.goto('/project/form')
    await page.getByLabel('项目名称 *').fill('合和新城')
    await page.getByLabel('项目经理 *').fill('合成项目经理')
    const saved = page.waitForResponse(response =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/commands/projects',
    )
    await page.getByRole('button', { name: '保存草稿' }).click()
    const savedResponse = await saved
    expect(savedResponse.ok()).toBe(true)
    const savedProject = await savedResponse.json() as { id: string }
    expect(savedProject.id).toBeTruthy()
    expect(savedProject.id).not.toBe('proj_demo_001')
    await expect(page).toHaveURL(new RegExp(`/project/${savedProject.id}\\?origin=real$`))

    await page.goto('/project')
    await expect(page.locator('[data-origin-summary="real"]')).toContainText(/当前筛选范围\s*1 个/)
    await includeDemo(page)
    await expect(page.locator('[data-origin-summary="real"]')).toContainText(/当前筛选范围\s*1 个/)
    await expect(page.locator('[data-origin-summary="demo"]')).toContainText(/当前筛选范围\s*12 个/)

    await page.getByPlaceholder('搜索项目、客户、经理…').fill('合和新城')
    await expect(page.locator('[data-origin-summary="real"]')).toContainText(/当前筛选范围\s*1 个/)
    await expect(page.locator('[data-origin-summary="demo"]')).toContainText(/当前筛选范围\s*1 个/)
    // 固定列与主表分别渲染，同一业务行的名称、来源和操作通过行键关联。
    const formalRow = page.locator(`tr[rowid="${encodeURIComponent(`real:${savedProject.id}`)}"]`)
    const demoRow = page.locator(`tr[rowid="${encodeURIComponent('demo:proj_demo_001')}"]`)
    await expect(formalRow.getByRole('cell', { name: '正式数据', exact: true })).toBeVisible()
    await expect(demoRow.getByRole('cell', { name: '测试数据', exact: true })).toBeVisible()
    const formalLink = formalRow.getByRole('link', { name: '合和新城', exact: true })
    const demoLink = demoRow.getByRole('link', { name: '合和新城', exact: true })
    await expect(formalLink).toBeVisible()
    await expect(demoLink).toBeVisible()
    const formalTarget = new URL((await formalLink.getAttribute('href'))!, page.url())
    const demoTarget = new URL((await demoLink.getAttribute('href'))!, page.url())
    expect(formalTarget.pathname).toBe(`/project/${savedProject.id}`)
    expect(formalTarget.searchParams.get('origin')).toBe('real')
    expect(demoTarget.pathname).toBe('/project/proj_demo_001')
    expect(demoTarget.searchParams.get('origin')).toBe('demo')
    await expect(formalRow.getByRole('link', { name: '编辑合和新城项目' })).toBeVisible()
    await expect(demoRow.getByRole('button', { name: '编辑项目' })).toBeDisabled()
    await expect(demoRow.getByRole('button', { name: '删除项目' })).toBeDisabled()

    await page.getByRole('button', { name: '关闭测试数据' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await expect(formalLink).toBeVisible()
    await expect(demoRow).toHaveCount(0)
    await expect(page.locator('[data-origin-summary="real"]')).toContainText(/当前筛选范围\s*1 个/)
    await expect(page.locator('[data-origin-summary="demo"]')).toHaveCount(0)
  })

  test('演示行与详情拒绝正式写入口，直接演示编辑路由也被拦截', async ({ page }) => {
    await openProductionOnlyList(page)
    await includeDemo(page)

    const edit = page.getByRole('button', { name: '编辑项目' }).first()
    const remove = page.getByRole('button', { name: '删除项目' }).first()
    await expect(edit).toBeDisabled()
    await expect(remove).toBeDisabled()
    await expect(edit).toHaveAttribute('title', '测试数据不能从正式入口修改')

    await page.goto('/project/proj_demo_001')
    await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()

    await page.goto('/project/proj_demo_001?origin=demo')
    await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()

    await page.goto('/project/form/proj_demo_001')
    await expect(page.getByText('项目表单载入失败')).toBeVisible()
    await expect(page.getByText('正式项目不存在')).toBeVisible()

    await page.goto('/project/form/proj_demo_001?origin=demo')
    await expect(page.getByRole('status', { name: '测试数据不能从正式入口修改' })).toBeVisible()
    await expect(page.getByText('保存并查看')).toHaveCount(0)
  })

  test('全局开关同时隔离其他本地业务读面和通知角标', async ({ page }) => {
    test.setTimeout(90_000)
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto('/base/customer')
    await expect(page.getByRole('status', { name: '还没有客户档案' })).toBeVisible({ timeout: 20_000 })
    expect(pageErrors).toEqual([])
    await expect(page.getByRole('button', { name: '打开通知中心，没有未读消息' })).toBeVisible()

    await page.getByRole('button', { name: '包含测试数据' }).click()
    await page.getByRole('button', { name: '取消' }).click()
    await expect(page.getByRole('status', { name: '还没有客户档案' })).toBeVisible()
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), DATA_VISIBILITY_STORAGE_KEY)).not.toBe('true')

    await page.getByRole('button', { name: '包含测试数据' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await expect(page.getByRole('link', { name: '广州市政集团', exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /打开通知中心，\d+ 条未读/ })).toBeVisible()

    await page.getByRole('link', { name: '广州市政集团', exact: true }).first().click()
    await expect(page).toHaveURL(/\/base\/customer\/customer_demo_013/)
    await page.getByRole('tabpanel', { name: '名下项目' }).getByRole('link').first().click()
    await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()

    await page.getByRole('button', { name: '关闭测试数据' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await page.goto('/base/customer')
    await expect(page.getByRole('status', { name: '还没有客户档案' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: '广州市政集团', exact: true })).toHaveCount(0)
  })

  test('后台在开关开启时验证查看演示数据 capability', async ({ page }, testInfo) => {
    const sessionId = testSession(testInfo)
    await resetProjectBackend(page.context().request, 'demo-forbidden', sessionId)
    await page.addInitScript(storageKey => localStorage.setItem(storageKey, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    const authorization = page.waitForResponse(candidate =>
      candidate.url().includes('/api/read/demo-workspace'),
    )
    await page.goto('/base/customer')
    expect(await (await authorization).json()).toEqual({ allowed: false })
    await expect(page.getByRole('button', { name: '包含测试数据' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('status', { name: '还没有客户档案' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: '打开通知中心，没有未读消息' })).toBeVisible()
    expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), DATA_VISIBILITY_STORAGE_KEY)).toBe('false')

    await page.getByRole('button', { name: '包含测试数据' }).click()
    await page.getByRole('button', { name: '确认切换' }).click()
    await expect(page.getByText('当前账号没有查看测试数据的权限')).toBeVisible()
    const status = await page.evaluate(async () => {
      const response = await fetch('/api/read/projects/proj_demo_001?origin=demo&includeDemo=true')
      return response.status
    })
    expect(status).toBe(403)
  })

  test('开关与来源汇总在各宽度不产生页面级横滚', async ({ page }) => {
    await openProductionOnlyList(page)
    await includeDemo(page)
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expectNoPageOverflow(page, `#279 测试数据开关 @ ${width}px`)
    }
  })
})
