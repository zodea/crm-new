import { expect, test } from '@playwright/test'

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
]

// 五类正式财务列表的等价工具、筛选和窄屏验收使用 production-finance-storage 中的隔离合成来源。
for (const list of lists) {
  test(`Issue #419：${list.label}列表保留紧凑工具与真实可操作表头`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(list.path)
    if (list.path === '/finance/receipt') {
      await expect(page.getByRole('heading', { name: list.label, exact: true }).last()).toBeVisible({ timeout: 30_000 })
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
      expect(errors).toEqual([])
      return
    }
    const toolbar = page.getByLabel('单据列表工具栏')
    await expect(toolbar.getByRole('heading', { name: list.label, exact: true })).toBeVisible({ timeout: 30_000 })
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(32)
    await expect(toolbar.getByRole('searchbox')).toBeVisible()
    await expect(toolbar.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: `新建${list.label}`, exact: true })).toBeVisible()
    await page.getByRole('button', { name: '筛选项目', exact: true }).click()
    await expect(page.getByRole('group', { name: '项目筛选值' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: '不限', exact: true })).toBeChecked()
    await page.getByRole('button', { name: '清除', exact: true }).click()
    await toolbar.getByRole('button', { name: '列表筛选', exact: true }).click()
    await expect(page.getByRole('group', { name: '项目', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: '状态', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
    expect(errors).toEqual([])
  })
}

test('Issue #419：材料列表在390、768、1024px保留局部滚动与筛选焦点', async ({ page }) => {
  test.setTimeout(120_000)
  for (const path of ['/material/arrival']) {
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      const toolbar = page.getByLabel('单据列表工具栏')
      await expect(toolbar).toBeVisible({ timeout: 30_000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      const filter = toolbar.getByRole('button', { name: '列表筛选', exact: true })
      await filter.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('group', { name: '项目', exact: true })).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(filter).toBeFocused()
    }
  }
})
