import { expect, test } from '@playwright/test'
import { installFinanceListFixtures } from './helpers/finance-list-fixture'

const lists = [
  { path: '/material/requisition', label: '下料单' },
  { path: '/material/arrival', label: '材料到货' },
  { path: '/material/use', label: '材料领用' },
  { path: '/material/stock-check', label: '库存盘点' },
  { path: '/owner-material/control', label: '甲供材总控量' },
  { path: '/owner-material/requisition', label: '甲供材下料单' },
  { path: '/owner-material/arrival', label: '甲供材到货' },
  { path: '/owner-material/use', label: '甲供材领用' },
  { path: '/owner-material/direct', label: '甲供材直入直出' },
  { path: '/finance/receipt', label: '收款登记' },
  { path: '/finance/billing', label: '开票申请' },
  { path: '/finance/current', label: '往来收付' },
  { path: '/finance/records', label: '支付记录' },
  { path: '/finance/reimbursement', label: '费用报销' },
  { path: '/finance/payment', label: '付款申请' },
]

test('Issue #419：十五类单据列表均保留紧凑工具与真实可操作表头', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await installFinanceListFixtures(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const list of lists) {
    await page.goto(list.path)
    if (list.path === '/finance/receipt') {
      await expect(page.getByRole('heading', { name: list.label, exact: true }).last()).toBeVisible()
      await expect(page.getByRole('searchbox', { name: '查找收款', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '重新读取', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '新增收款', exact: true })).toHaveAttribute('href', /^\/finance\/receipt\/new\?origin=real&returnTo=/)
      await expect(page.getByRole('combobox', { name: '筛选项目', exact: true })).toHaveValue('')
      const status = page.getByRole('combobox', { name: '筛选状态', exact: true })
      await status.click()
      await expect(page.getByRole('option', { name: '草稿', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(status).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
      continue
    }
    const toolbar = page.getByLabel('单据列表工具栏')
    await expect(toolbar.getByRole('heading', { name: list.label, exact: true })).toBeVisible()
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(32)
    await expect(toolbar.getByRole('searchbox')).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: `新建${list.label}`, exact: true })).toBeVisible()
    const projectHeader = page.getByRole('button', { name: '筛选项目', exact: true })
    await expect(projectHeader, `${list.path} 应挂载可操作项目列`).toBeVisible()
    await projectHeader.click()
    await expect(page.getByRole('group', { name: '项目筛选值' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: '不限', exact: true })).toBeChecked()
    await page.getByRole('button', { name: '清除', exact: true }).click()
    await toolbar.getByRole('button', { name: '列表筛选', exact: true }).click()
    await expect(page.getByRole('group', { name: '项目', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '状态', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
    if (list.path === '/material/arrival' || list.path === '/finance/payment')
      await page.screenshot({ path: testInfo.outputPath(`${list.path.includes('material') ? 'material' : 'finance'}-list-1440.png`) })
  }
  expect(errors).toEqual([])
})

test('Issue #419：材料和资金列表在390、768、1024px保留局部滚动与筛选焦点', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await installFinanceListFixtures(page)
  for (const path of ['/material/arrival', '/finance/payment']) {
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      const toolbar = page.getByLabel('单据列表工具栏')
      await expect(toolbar).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const filter = toolbar.getByRole('button', { name: '列表筛选', exact: true })
      await filter.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('group', { name: '项目', exact: true })).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(filter).toBeFocused()
      if (width === 390)
        await page.screenshot({ path: testInfo.outputPath(`${path.includes('material') ? 'material' : 'finance'}-list-390.png`) })
    }
  }
})
