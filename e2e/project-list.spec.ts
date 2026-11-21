import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { EQUIVALENT_200_PERCENT_VIEWPORT, expectInViewport, expectLocalHorizontalScroll, expectNoPageOverflow, expectTabSequence, RESPONSIVE_WIDTHS, tabUntilFocused } from './helpers/responsive'

test.describe('项目列表与表单旅程', () => {
  const VIEWPORT_HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
    390: 844,
    768: 900,
    1024: 900,
    1440: 1000,
  }

  const RESPONSIVE_CASES = [
    ...RESPONSIVE_WIDTHS.map(width => ({
      label: `${width}px`,
      width,
      height: VIEWPORT_HEIGHTS[width],
    })),
    {
      label: '720px 等效 200%',
      ...EQUIVALENT_200_PERCENT_VIEWPORT,
    },
  ] as const

  function projectListTable(page: Page) {
    return page.locator('[data-list-shell-table] [data-ui="kit-table"]')
  }

  function vxeBodyScroller(table: Locator) {
    return table.locator(
      '.vxe-table--main-wrapper .vxe-table--body-inner-wrapper',
    )
  }

  async function waitForProjectList(page: Page) {
    const table = projectListTable(page)
    await expect(table).toBeVisible({ timeout: 20_000 })
    await expect(table.locator('[data-ui="kit-table-loading"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '合和新城', exact: true }).first())
      .toBeVisible()
    return table
  }

  test.describe('Issue #190：项目列表、详情与表单参考旅程', () => {
    test.beforeEach(async ({ page }, info) => {
      const sessionId = Buffer.from(info.testId).toString('base64url')
      await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
      const reset = await page.request.post('/api/testing/projects/reset', {
        headers: { 'x-ruihang-test-reset': '1' },
        data: { scenario: 'ready' },
      })
      expect(reset.ok()).toBe(true)
      await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    })

    for (const input of [
      { id: 'proj_demo_001', name: '合和新城', excludedName: '锦绣华庭' },
      { id: 'proj_demo_002', name: '锦绣华庭', excludedName: '合和新城' },
    ]) {
      test(`${input.name} 阶段与搜索来源返回保持筛选并复用应用页签`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.goto('/project')
        await waitForProjectList(page)

        const phaseNavigation = page.getByRole('navigation', { name: '列表分类' })
        await phaseNavigation.getByRole('button', { name: /施工中/ }).click()

        const search = page.getByRole('searchbox', {
          name: '搜索项目、客户、经理…',
        })
        await search.fill(input.name)
        const projectLink = page.getByRole('link', {
          name: input.name,
          exact: true,
        }).first()
        await expect(projectLink).toBeVisible()
        await expect(page.getByRole('link', { name: input.excludedName, exact: true }))
          .toHaveCount(0)

        await projectLink.click()
        await expect(page).toHaveURL(new RegExp(`/project/${input.id}\\?origin=demo`))
        await expect(page.getByRole('heading', { name: input.name, exact: true }))
          .toBeVisible()

        const readonlyDetails = page.getByRole('status', { name: '测试数据只读详情' })
        await expect(readonlyDetails).toBeVisible()
        await expect(readonlyDetails.getByRole('heading', { name: '基础信息' })).toBeVisible()

        const appTabs = page.getByRole('navigation', { name: '已打开页面' })
        const detailAppTab = appTabs.getByRole('button', {
          name: input.name,
          exact: true,
        })
        await expect(detailAppTab).toHaveCount(1)
        const tabCount = await appTabs.locator('[data-tab-trigger]').count()

        await page.getByRole('link', { name: '返回项目列表', exact: true }).click()
        await expect(page).toHaveURL(/\/project\?.*search=/)
        await expect(search).toHaveValue(input.name)
        await expect(projectLink).toBeVisible()

        await detailAppTab.click()
        await expect(page).toHaveURL(new RegExp(`/project/${input.id}\\?origin=demo`))
        await expect(readonlyDetails).toBeVisible()
        await expect(appTabs.locator('[data-tab-trigger]')).toHaveCount(tabCount)
        await expect(detailAppTab).toHaveCount(1)
      })
    }

    for (const input of [
      { name: '中央参考项目甲', manager: '张经理' },
      { name: '中央参考项目乙', manager: '李经理' },
    ]) {
      test(`新建取消及正式项目 ${input.name} 编辑取消、保存往返`, async ({ page }) => {
        await page.goto('/project/form')
        await expect(page.getByRole('heading', { name: '新建 · 项目' })).toBeVisible()
        await page.getByRole('group', { name: '表单操作' })
          .getByRole('button', { name: '取消', exact: true })
          .click()
        await expect(page).toHaveURL('/project')

        await page.goto('/project/form')
        const createdProjectName = input.name
        await page.getByLabel('项目名称 *').fill(createdProjectName)
        await page.getByLabel('项目经理 *').fill(input.manager)
        await page.getByRole('group', { name: '表单操作' })
          .getByRole('button', { name: '保存草稿', exact: true })
          .click()
        await expect(page).toHaveURL(/\/project\/[^/?]+\?origin=real/)
        const createdId = new URL(page.url()).pathname.split('/').at(-1)!
        await expect(page.getByRole('heading', { name: createdProjectName, exact: true }))
          .toBeVisible()

        await page.getByRole('link', { name: '编辑项目', exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/project/form/${createdId}\\?origin=real`))
        await expect(page.getByRole('heading', { name: '编辑 · 项目' })).toBeVisible()
        await page.getByRole('group', { name: '表单操作' })
          .getByRole('button', { name: '取消', exact: true })
          .click()
        await expect(page).toHaveURL(new RegExp(`/project/${createdId}\\?origin=real`))
        await expect(page.getByRole('heading', { name: createdProjectName, exact: true }))
          .toBeVisible()

        await page.getByRole('link', { name: '编辑项目', exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/project/form/${createdId}\\?origin=real`))
        const updatedName = `${createdProjectName}（已修改）`
        await page.getByLabel('项目名称 *').fill(updatedName)
        await page.getByRole('group', { name: '表单操作' })
          .getByRole('button', { name: '保存草稿', exact: true })
          .click()
        await expect(page).toHaveURL(new RegExp(`/project/${createdId}\\?origin=real`))
        await expect(page.getByRole('heading', { name: updatedName, exact: true }))
          .toBeVisible()
      })
    }

    test('各宽度无页面横滚，项目宽表局部横滚且关键操作键盘可达', async ({ page }) => {
      const desktop = { width: 1440, height: VIEWPORT_HEIGHTS[1440] }
      await page.setViewportSize(desktop)
      await page.goto('/project')
      const listTable = await waitForProjectList(page)
      const createProject = page.getByRole('button', {
        name: '新增项目',
        exact: true,
      })
      await expect(createProject).toBeEnabled()
      await expect(createProject).toHaveAttribute(
        'title',
        '新增正式项目',
      )
      for (const viewport of RESPONSIVE_CASES) {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        })
        await expectNoPageOverflow(page, `${viewport.label} 项目列表`)
        await expectLocalHorizontalScroll(
          vxeBodyScroller(listTable),
          `${viewport.label} 项目列表宽表`,
        )
        await createProject.scrollIntoViewIfNeeded()
        await expectInViewport(createProject, `${viewport.label} 新增项目操作`)
      }

      await page.setViewportSize(desktop)
      await page.goto('/project/proj_demo_001?origin=demo')
      const detail = page.locator('[data-ui="project-detail-screen"]')
      await expect(detail).toBeVisible()
      await expect(page.getByRole('link', {
        name: '编辑项目',
        exact: true,
      })).toHaveCount(0)
      await expect(page.getByRole('status', { name: '测试数据只读详情' })).toBeVisible()
      const closeDetail = page.getByRole('link', { name: '返回项目列表' })
      await tabUntilFocused(page, closeDetail)
      for (const viewport of RESPONSIVE_CASES) {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        })
        await closeDetail.scrollIntoViewIfNeeded()
        await expectInViewport(closeDetail, `${viewport.label} 关闭项目详情操作`)
        await expectNoPageOverflow(page, `${viewport.label} 项目详情`)
      }
    })

    test('项目表单在各宽度保持固定操作条并支持键盘操作', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: VIEWPORT_HEIGHTS[1440] })
      await page.goto('/project/form')
      const createProject = page.getByRole('button', { name: '新增项目', exact: true })
      const shell = page.locator('[data-ui="entity-form-shell"]')
      const footer = shell.getByRole('group', { name: '表单操作' })
      await expect(shell.getByRole('navigation', { name: '表单分区' }))
        .toHaveCount(0)
      await expect(footer).toHaveCSS('position', 'sticky')
      const firstField = page.getByLabel('项目名称 *')
      await firstField.fill('视口项目草稿')
      const cancel = footer.getByRole('button', { name: '取消', exact: true })
      const save = footer.getByRole('button', { name: '保存草稿', exact: true })
      await expectTabSequence(
        page,
        firstField,
        [cancel, save],
        '项目表单关键操作',
      )
      for (const [index, viewport] of RESPONSIVE_CASES.entries()) {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        })
        // 固定操作条按进入时的滚动容器定位；从列表重新进入，避免每档完整冷启动。
        await cancel.click()
        if (index === 0)
          await page.getByRole('dialog', { name: '放弃修改' }).getByRole('button', { name: '放弃修改', exact: true }).click()
        await expect(page).toHaveURL('/project')
        await createProject.click()
        await expect(firstField).toBeVisible()
        await expectInViewport(footer, `${viewport.label} 项目表单固定操作条`)
        await expectNoPageOverflow(page, `${viewport.label} 项目表单`)
      }
    })
  })
})

test.describe('项目中央 HTTP', () => {
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
      const sourceTag = page.locator('[data-list-shell-table] [data-ui="kit-table"]').getByText('测试数据', { exact: true }).first()
      await expect(sourceTag).toHaveAttribute('data-ui', 'status-tag')

      const summary = page.getByLabel('项目列表汇总')
      await expect(summary).toContainText(/测试数据.*累计收入\s*未知（已知小计 ¥25,367,027\.00）.*收入缺失 10 个/)
      await expect(summary).toContainText(/测试数据.*预算总额\s*未知（已知小计 ¥800,000\.00）.*预算缺失 10 个/)
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
      await expect(page.getByLabel('项目列表汇总')).toContainText(/测试数据\s*当前筛选范围\s*1 个/)
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
})

test.describe('项目返回上下文', () => {
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
})
