import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const listCases = [
  { domain: 'construction', title: '施工合同', party: '客户', root: 'construction-contract-list', search: '搜索施工合同', searchRole: 'searchbox' },
  { domain: 'subcontract', title: '分包合同', party: '分供方', root: 'subcontract-contract-list', search: '搜索分包合同', searchRole: 'textbox' },
  { domain: 'material', title: '材料采购合同', party: '分供方', root: 'material-contract-list', search: '搜索材料采购合同', searchRole: 'searchbox' },
] as const

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `contract-list-${randomUUID()}` })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
  for (const list of listCases) {
    const response = await page.request.post(`/api/testing/${list.domain}-contracts/reset`, {
      headers: { 'x-ruihang-test-reset': '1' },
      data: { scenario: 'ready' },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
})

for (const list of listCases) {
  test(`${list.title} 保留领域筛选与新建入口，各宽度宽表只在内部滚动`, async ({ page }) => {
    await page.goto(`/contract/${list.domain}`)
    const root = page.getByTestId(list.root)
    await expect(root.getByRole('heading', { name: list.title, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-list-shell].list-shell--continuous [data-ui="kit-table"]')).toBeVisible()
    const filters = root.getByRole('region', { name: `${list.title}筛选`, exact: true })
    const search = root.getByRole(list.searchRole, { name: list.search, exact: true })
    const create = root.getByRole('link', { name: `新建${list.title}`, exact: true })
    await expect(create).toHaveAttribute('href', `/contract/${list.domain}/form`)
    const scroller = root.locator('.vxe-table--body-inner-wrapper').first()
    const filterHeights = new Map<number, number>()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expect(filters.getByRole('combobox', { name: '筛选项目', exact: true })).toBeVisible()
      await expect(filters.getByRole('combobox', { name: `筛选${list.party}`, exact: true })).toBeVisible()
      await expect(filters.getByRole('button', { name: /^筛选状态，已选 0 项$/ })).toBeVisible()
      await expect(search).toBeVisible()
      await expect(create).toBeVisible()
      if (list.domain === 'subcontract')
        await expect(filters.getByRole('button', { name: /^筛选分包类别，已选 0 项$/ })).toBeVisible()
      await expectNoPageOverflow(page, `${width}px ${list.title}列表`)
      await expect(scroller).toBeVisible()
      if (width <= 768)
        await expectLocalHorizontalScroll(scroller, `${width}px ${list.title}表格`)
      const filterBox = await filters.boundingBox()
      expect(filterBox).not.toBeNull()
      filterHeights.set(width, filterBox!.height)
    }

    await search.fill(`不存在的${list.title}`)
    await expect(page.getByRole('status', { name: '没有符合当前筛选条件的合同', exact: true })).toBeVisible()
    await expect(search).toHaveValue(`不存在的${list.title}`)
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      expect(Math.abs((await filters.boundingBox())!.height - filterHeights.get(width)!), `${width}px`).toBeLessThanOrEqual(1)
      await expect(create).toBeVisible()
      await expectNoPageOverflow(page, `${width}px ${list.title}空结果`)
    }
  })
}

test('材料采购演示合同只读，名称链接支持键盘进入并返回原筛选', async ({ page }) => {
  await page.goto('/contract/material?search=瓷砖采购合同')
  const root = page.getByTestId('material-contract-list')
  const rowLink = root.getByRole('link', { name: '瓷砖采购合同', exact: true })
  await expect(rowLink).toHaveAttribute('href', /\/contract\/con_demo_cg01\?origin=demo&contractKind=material&returnTo=/)
  const rowTags = root.locator('.vxe-body--column [data-ui="status-tag"]')
  await expect(rowTags.getByText('履约中', { exact: true })).toBeVisible()
  await expect(rowTags.getByText('演示', { exact: true })).toBeVisible()
  await expect(root.locator('[data-ui="row-action-menu-trigger"]')).toHaveCount(0)
  await rowLink.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '瓷砖采购合同', exact: true })).toBeVisible()
  await expect(page.getByTestId('material-contract-edit')).toHaveCount(0)
  await expect(page.getByText('演示只读', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '返回材料采购合同列表', exact: true }).click()
  await expect(root.getByRole('searchbox', { name: '搜索材料采购合同', exact: true })).toHaveValue('瓷砖采购合同')
  await expect(rowLink).toBeFocused()
})

for (const state of [
  { name: '履约中', visible: true },
  { name: '草稿', visible: false },
]) {
  test(`材料采购状态多选筛选保持独立预期：${state.name}`, async ({ page }) => {
    await page.goto('/contract/material?search=瓷砖采购合同')
    await expect(page.getByRole('link', { name: '瓷砖采购合同', exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^筛选状态，已选 0 项$/ }).click()
    await page.getByRole('checkbox', { name: state.name, exact: true }).check()
    await page.getByRole('button', { name: '应用', exact: true }).click()
    await expect(page).toHaveURL(url => url.searchParams.get('status') === JSON.stringify([state.name]))
    if (state.visible)
      await expect(page.getByRole('link', { name: '瓷砖采购合同', exact: true })).toBeVisible()
    else
      await expect(page.getByRole('status', { name: '没有符合当前筛选条件的合同', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: /^筛选状态，已选 1 项$/ })).toHaveText(state.name)
  })
}
