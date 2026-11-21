import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { installScheduleProductionFixture } from './helpers/quantity-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.describe('首页看板', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-06T04:00:00.000Z'))
  })

  test('Issue #189：首页默认工作台只展示真实排程并保持项目、分组与下钻入口可达', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    const fixture = await installScheduleProductionFixture(page)
    await page.goto(`/?project=${fixture.projectId}&origin=real`)

    await expect(page.getByTestId('project-switcher-trigger')).toContainText('E2E正式工程量项目')
    await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '全部项目', exact: true }))
      .toHaveAttribute('href', '/project')

    await page.evaluate(() => {
      window.history.pushState({}, '', '/?project=project-missing&origin=real&group=stale-group&task=stale-task')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByRole('alert', { name: '首页施工进度加载失败' })).toBeVisible()
    await expect(page).toHaveURL(/project=project-missing/)
    await page.goto(`/?project=${fixture.projectId}&origin=real`)

    const expandedGroup = page.getByRole('button', { name: '折叠分组：正式一栋组', exact: true })
    const task = page.getByRole('button', { name: /卫生间回填及防水/ }).first()
    await expect(task).toBeVisible()
    await expandedGroup.click()
    await expect(task).toBeHidden()
    await page.getByRole('button', { name: '展开分组：正式一栋组', exact: true }).click()
    await expect(task).toBeVisible()

    await expectNoPageOverflow(page, '首页分组折叠')
  })

  for (const state of [
    { query: 'loading', role: 'status', title: '正在读取首页施工进度' },
    { query: 'schedule-empty', role: 'status', title: '状态预览项目还没有施工排程' },
    { query: 'partial', role: 'status', title: '部分排程数据尚未就绪' },
    { query: 'error', role: 'alert', title: '首页施工进度加载失败' },
  ] as const) {
    test(`Issue #189：首页状态预览 ${state.query} 保留对应恢复行为`, async ({ page }) => {
      await page.goto(`/dev/home-dashboard?state=${state.query}`)
      const panel = page.getByRole(state.role, { name: state.title, exact: true })
      await expect(panel).toBeVisible()
      if (state.query === 'schedule-empty') {
        await expect(page.getByRole('link', { name: '新建楼栋分组', exact: true })).toHaveAttribute('href', /\/schedule\/new\?project=project-preview/)
        await expect(page.getByRole('link', { name: '打开施工进度', exact: true })).toHaveAttribute('href', /\/schedule\?project=project-preview/)
      }
      if (state.query === 'error') {
        await panel.getByRole('button', { name: '重新加载', exact: true }).click()
        await expect(page.getByRole('status', { name: '部分排程数据尚未就绪', exact: true })).toBeVisible()
      }
      if (state.query === 'partial' || state.query === 'error')
        await expect(page.getByRole('heading', { name: '施工进度', exact: true })).toBeVisible()
    })
  }
})

test.describe('首页项目来源', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const sessionId = Buffer.from(testInfo.testId, 'utf8').toString('base64url')
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    const reset = await page.request.post('/api/testing/projects/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario: 'ready' } })
    expect(reset.ok()).toBe(true)
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
  })

  test.afterEach(async ({ page }, testInfo) => {
    const sessionId = Buffer.from(testInfo.testId, 'utf8').toString('base64url')
    const reset = await page.request.post('/api/testing/projects/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario: 'ready' } })
    expect(reset.ok()).toBe(true)
  })

  test('中央新项目空排程只读查看并返回同一身份，各宽度无页面溢出', async ({ page }) => {
    const widths = [390, 768, 1024, 1280, 1440] as const
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/project/form')
    const name = '首页中央项目'
    await page.getByLabel('项目名称 *').fill(name)
    await page.getByLabel('项目经理 *').fill('项目经理')
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/projects')
    await page.getByRole('button', { name: '保存草稿' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page).toHaveURL(/\/project\/[A-Za-z0-9-]+\?origin=real$/)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    await page.goto(`/?project=${id}&origin=real`)
    const switcher = page.getByTestId('project-switcher-trigger')
    await expect(switcher).toContainText(name)
    await expect(page).toHaveURL(new RegExp(`project=${id}&origin=real`))
    await switcher.focus()
    await page.keyboard.press('ArrowDown')
    const search = page.getByRole('combobox', { name: '搜索项目' })
    await expect(search).toBeFocused()
    await search.fill(name)
    await expect(page.getByRole('option', { name: new RegExp(name) }).last()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(switcher).toBeFocused()
    const sourceLinkStyle = await page.getByRole('link', { name: '打开施工进度', exact: true }).evaluate(element => ({ borderStyle: getComputedStyle(element).borderTopStyle, decoration: getComputedStyle(element).textDecorationLine }))
    expect(sourceLinkStyle).toEqual({ borderStyle: 'solid', decoration: 'none' })
    const empty = page.getByRole('status', { name: `${name}还没有施工排程` })
    await expect(empty).toContainText('已读取对应项目排程，当前没有楼栋分组。此入口仅提供只读查看。')
    await expect(page.getByTestId('home-schedule-scroll')).toHaveCount(0)
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 })
      await expectNoPageOverflow(page, `${width}px 首页`)
    }
    await page.getByRole('link', { name: '打开施工进度', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/schedule\\?project=${id}&origin=real&from=home`))
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('status', { name: '当前项目还没有施工排程' })).toBeVisible()
    await expect(page.getByRole('link', { name: '新建楼栋分组' })).toHaveCount(0)
    for (const width of widths) {
      await page.setViewportSize({ width, height: 960 })
      await expectNoPageOverflow(page, `${width}px 来源查看`)
    }
    await page.getByRole('link', { name: '返回首页项目' }).click()
    await expect(page).toHaveURL(new RegExp(`project=${id}&origin=real`))
    await expect(page.getByTestId('project-switcher-trigger')).toContainText(name)
    expect(errors).toEqual([])
  })

  test('删除或来源不匹配的深链不借用首个本地项目', async ({ page }) => {
    await page.goto('/schedule?project=proj_demo_001&origin=real&from=home')
    await expect(page.getByRole('alert', { name: '项目施工进度读取失败' })).toBeVisible()
    await expect(page.getByTestId('home-schedule-scroll')).toHaveCount(0)
    await page.getByRole('link', { name: '返回首页项目' }).click()
    await expect(page.getByRole('alert', { name: '首页施工进度加载失败' })).toBeVisible()
    await expect(page).toHaveURL(/project=proj_demo_001&origin=real/)
  })

  test('缓存首页当前项目关系失效后撤下旧事实与查看入口', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 960 })
    await page.goto('/project/form')
    const name = '首页来源关系验证项目'
    await page.getByLabel('项目名称 *').fill(name)
    await page.getByLabel('项目经理 *').fill('项目经理')
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/projects')
    await page.getByRole('button', { name: '保存草稿' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page).toHaveURL(/\/project\/[A-Za-z0-9-]+\?origin=real$/)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    await page.goto(`/?project=${id}&origin=real`)
    await expect(page.getByRole('status', { name: `${name}还没有施工排程` })).toBeVisible()
    await page.getByRole('link', { name: '全部项目', exact: true }).click()
    await expect(page).toHaveURL('/project')
    await page.route(`**/api/read/projects/${id}?*`, route => route.fulfill({
      status: 409,
      json: { data: { code: 'relationship-mismatch', message: '项目来源关系已失效', retryable: false, fieldErrors: {}, traceId: null } },
    }))
    await page.goBack()
    await expect(page.getByRole('alert', { name: '首页施工进度加载失败' })).toContainText('项目来源关系已失效')
    await expect(page.getByRole('status', { name: `${name}还没有施工排程` })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '打开施工进度', exact: true })).toHaveCount(0)
    await expectNoPageOverflow(page, '390px 当前项目关系失效')
  })

  test('离开缓存首页后，迟到的项目读取不污染项目列表地址', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.goto('/?project=proj_demo_001&origin=demo')
    await expect(page.getByTestId('project-switcher-trigger')).toContainText('合和新城')
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/read/projects/proj_demo_002?*', async (route) => {
      await pending
      await route.continue()
    })
    const requested = page.waitForRequest(request => request.url().includes('/api/read/projects/proj_demo_002?'))
    await page.getByTestId('project-switcher-trigger').click()
    await page.getByRole('combobox', { name: '搜索项目' }).fill('锦绣华庭')
    await page.keyboard.press('Enter')
    await requested
    await page.getByRole('link', { name: '全部项目', exact: true }).click()
    await expect(page).toHaveURL('/project')
    const response = page.waitForResponse(candidate => candidate.url().includes('/api/read/projects/proj_demo_002?'))
    release()
    expect((await response).ok()).toBe(true)
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page).toHaveURL('/project')
  })
})
