import type { Locator, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectInViewport,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  expectTabSequence,
  RESPONSIVE_WIDTHS,
  tabUntilFocused,
} from './helpers/responsive'

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
