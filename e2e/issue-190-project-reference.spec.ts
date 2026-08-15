import type { Locator, Page } from '@playwright/test'
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
  test('真实阶段与搜索进入详情，业务 Tab 通过应用页签返回后保持复用', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/project')
    await waitForProjectList(page)

    const phaseNavigation = page.getByRole('navigation', { name: '列表分类' })
    await phaseNavigation.getByRole('button', { name: /施工中/ }).click()

    const search = page.getByRole('searchbox', {
      name: '搜索项目、客户、经理…',
    })
    await search.fill('合和新城')
    const projectLink = page.getByRole('link', {
      name: '合和新城',
      exact: true,
    }).first()
    await expect(projectLink).toBeVisible()
    await expect(page.getByRole('link', { name: '锦绣华庭', exact: true }))
      .toHaveCount(0)

    await projectLink.click()
    await expect(page).toHaveURL('/project/proj_demo_001')
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()

    const expenditureTab = page.getByRole('tab', {
      name: '支出合同管理',
      exact: true,
    })
    await expenditureTab.click()
    await expect(expenditureTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('region', { name: '支出合同', exact: true }))
      .toBeVisible()

    const appTabs = page.getByRole('navigation', { name: '已打开页面' })
    const detailAppTab = appTabs.getByRole('button', {
      name: '合和新城',
      exact: true,
    })
    await expect(detailAppTab).toHaveCount(1)
    const tabCount = (await page.getByTitle('当前页签数量').textContent() ?? '').trim()

    await appTabs.getByRole('button', { name: '项目列表', exact: true }).click()
    await expect(page).toHaveURL('/project')
    await expect(search).toHaveValue('合和新城')
    await expect(projectLink).toBeVisible()

    await detailAppTab.click()
    await expect(page).toHaveURL(/\/project\/proj_demo_001\?tab=expenditure$/)
    await expect(expenditureTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTitle('当前页签数量')).toContainText(tabCount)
    await expect(detailAppTab).toHaveCount(1)
  })

  test('新建取消回项目列表，编辑取消或保存均回原项目详情', async ({ page }) => {
    await page.goto('/project/form')
    await expect(page.getByRole('heading', { name: '新建 · 项目' })).toBeVisible()
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await expect(page).toHaveURL('/project')

    await page.goto('/project/form')
    const createdProjectName = `E2E 新建项目 ${Date.now()}`
    await page.getByLabel('项目名称 *').fill(createdProjectName)
    await page.getByLabel('项目经理 *').fill('E2E 项目经理')
    const customerLookup = page.getByRole('combobox', { name: '检索客户' })
    await customerLookup.click()
    const firstCustomer = page.locator('[role="option"]:visible').first()
    await expect(firstCustomer).toBeVisible()
    await firstCustomer.click()
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存', exact: true })
      .click()
    await expect(page).toHaveURL(/\/project\/proj_/)
    await expect(page.getByRole('heading', { name: createdProjectName, exact: true }))
      .toBeVisible()

    await page.goto('/project/proj_demo_001')
    await page.getByRole('link', { name: '编辑项目', exact: true }).click()
    await expect(page).toHaveURL('/project/form/proj_demo_001')
    await expect(page.getByRole('heading', { name: '编辑 · 项目' })).toBeVisible()
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '取消', exact: true })
      .click()
    await expect(page).toHaveURL('/project/proj_demo_001')
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()

    await page.getByRole('link', { name: '编辑项目', exact: true }).click()
    await expect(page).toHaveURL('/project/form/proj_demo_001')
    await page.getByRole('group', { name: '表单操作' })
      .getByRole('button', { name: '保存', exact: true })
      .click()
    await expect(page).toHaveURL('/project/proj_demo_001')
    await expect(page.getByRole('heading', { name: '合和新城', exact: true }))
      .toBeVisible()
  })

  for (const viewport of RESPONSIVE_CASES) {
    test(`${viewport.label} 无页面横滚，项目宽表局部横滚且关键操作键盘可达`, async ({ page }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })

      await page.goto('/project')
      const listTable = await waitForProjectList(page)
      await expectNoPageOverflow(page, `${viewport.label} 项目列表`)
      await expectLocalHorizontalScroll(
        vxeBodyScroller(listTable),
        `${viewport.label} 项目列表宽表`,
      )

      const createProject = page.getByRole('button', {
        name: '新增项目',
        exact: true,
      })
      await createProject.scrollIntoViewIfNeeded()
      await expect(createProject).toBeEnabled()
      await expect(createProject).toHaveAttribute(
        'title',
        '新增正式项目',
      )
      await expectInViewport(createProject, `${viewport.label} 新增项目操作`)

      await page.goto('/project/proj_demo_001')
      const detail = page.locator('[data-ui="project-detail-screen"]')
      await expect(detail).toBeVisible()
      await expectNoPageOverflow(page, `${viewport.label} 项目详情`)

      await expect(page.getByRole('link', {
        name: '编辑项目',
        exact: true,
      })).toHaveCount(0)
      const closeDetail = page.getByRole('link', { name: '关闭项目详情' })
      await tabUntilFocused(page, closeDetail)
      await expectInViewport(closeDetail, `${viewport.label} 关闭项目详情操作`)

      await page.getByRole('tab', {
        name: '支出合同管理',
        exact: true,
      }).click()
      const detailTableScroller = page
        .locator('[data-ui="project-detail-table-scroll"]')
        .getByRole('region', { name: '支出合同', exact: true })
        .locator('[data-ui="kit-table"]')
        .locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')
      await expectLocalHorizontalScroll(
        detailTableScroller,
        `${viewport.label} 项目详情宽表`,
      )
      await expectNoPageOverflow(page, `${viewport.label} 项目详情业务 Tab`)

      await page.goto('/project/form')
      const shell = page.locator('[data-ui="entity-form-shell"]')
      const footer = shell.getByRole('group', { name: '表单操作' })
      await expect(shell.getByRole('navigation', { name: '表单分区' }))
        .toHaveCount(0)
      await expect(footer).toHaveCSS('position', 'sticky')
      await expectInViewport(footer, `${viewport.label} 项目表单固定操作条`)

      const firstField = page.getByLabel('项目名称 *')
      const cancel = footer.getByRole('button', { name: '取消', exact: true })
      const save = footer.getByRole('button', { name: '保存', exact: true })
      await expectTabSequence(
        page,
        firstField,
        [cancel, save],
        `${viewport.label} 项目表单关键操作`,
      )
      await expectNoPageOverflow(page, `${viewport.label} 项目表单`)
    })
  }
})
