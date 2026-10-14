import { expect, test } from '@playwright/test'
import { installQuantityProductionFixture } from './helpers/quantity-production-fixture'

const unit = { code: '101', name: '101户', floor: '1层', building: '1栋', stage: '泥水完成', trade: '泥水工' }
const draftCases = [
  { label: '月中登记', date: '2026-08-15', note: '缺照片软卡保留输入' },
  { label: '跨月登记', date: '2026-09-01', note: '跨月缺照片草稿保持' },
]
const viewports = [390, 768, 1024, 1280, 1440]
const missingCases = [
  { label: '正式项目不存在的户', missingProject: false, error: /不属于当前项目|不存在/ },
  { label: '不存在的项目', missingProject: true, error: /正式项目不可用|不存在/ },
]

async function documentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('Issue #103 Slice 6A：户施工详情', () => {
  test('矩阵时间线进入详情页，工种→阶段→日期与三量合计贯通', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await installQuantityProductionFixture(page, { detailedStages: true })

    await expect(page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })).toBeVisible()

    const cell = page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })
    await cell.focus()
    await cell.press('Enter')
    await page.getByRole('button', { name: `详情 ${unit.name}` }).click()

    await expect(page).toHaveURL(/\/subcontract\/quantity\/[^/?]+\/[^/?]+\?/)
    expect(new URL(page.url()).searchParams.get('origin')).toBe('real')
    await expect(page.getByRole('heading', { name: new RegExp(`${unit.building} ${unit.floor} ${unit.name}`) })).toBeVisible()

    // 工种 → 工序阶段 → 完成日期；墙砖/地砖、防水一遍/二遍分别成行。
    await expect(page.getByRole('region', { name: '泥水工施工记录' })).toContainText('墙砖铺贴')
    await expect(page.getByRole('region', { name: '泥水工施工记录' })).toContainText('地砖铺贴')
    await expect(page.getByRole('region', { name: '防水工施工记录' })).toContainText('防水一遍')
    await expect(page.getByRole('region', { name: '防水工施工记录' })).toContainText('防水二遍')

    // 当前责任与完成时执行责任同屏；毛利参考在单价落地前显示占位。
    await expect(page.getByText('完成时执行责任').first()).toBeVisible()
    await expect(page.getByText('待单价数据').first()).toBeVisible()
    await expect(page.getByRole('region', { name: '全户合计' })).toContainText('合同量')

    // 详情页可直接打开该阶段的完成登记。
    await page.getByRole('region', { name: `${unit.trade}施工记录` }).locator('article').filter({ has: page.getByText(unit.stage, { exact: true }) }).getByRole('button', { name: '登记', exact: true }).click()
    await expect(page.getByRole('dialog').filter({ hasText: '阶段完成登记' })).toBeVisible()
    await page.keyboard.press('Escape')

    expect(pageErrors).toEqual([])
  })

  test('下钻带走矩阵筛选，返回后按原筛选恢复', async ({ page }) => {
    await installQuantityProductionFixture(page, { detailedStages: true })
    await expect(page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })).toBeVisible()

    // 先把矩阵切到非默认筛选，返回时才能证明恢复的是用户的选择而不是默认值。
    await page.getByRole('tab', { name: '班组矩阵' }).click()
    await expect(page).toHaveURL(/view=crew/)
    const matrixUrl = new URL(page.url())
    await page.reload()
    await expect(page.getByRole('tab', { name: '班组矩阵' })).toHaveAttribute('data-state', 'active')
    await expect(page).toHaveURL(/view=crew/)

    const cell = page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })
    await cell.focus()
    await cell.press('Enter')
    await page.getByRole('button', { name: `详情 ${unit.name}`, exact: true }).click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\/[^/]+\/[^/]+/)
    // 下钻地址必须带上筛选，否则返回时无从恢复。
    await expect(page).toHaveURL(/view=crew/)
    await page.reload()
    await expect(page.getByRole('heading', { name: new RegExp(`${unit.building} ${unit.floor} ${unit.name}`) })).toBeVisible()
    await expect(page).toHaveURL(/view=crew/)

    await page.getByRole('link', { name: '返回工程量矩阵' }).click()
    await expect(page).toHaveURL(/\/subcontract\/quantity\?/)
    await expect(page).toHaveURL(/view=crew/)
    expect(new URL(page.url()).searchParams.get('project'))
      .toBe(matrixUrl.searchParams.get('project'))
  })

  test('页面在各宽度无横滚，量明细仅自身局部横滚', async ({ page }) => {
    await installQuantityProductionFixture(page, { detailedStages: true })
    await expect(page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })).toBeVisible()
    const cell = page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })
    await cell.focus()
    await cell.press('Enter')
    await page.getByRole('button', { name: `详情 ${unit.name}` }).click()
    await expect(page.getByRole('heading', { name: new RegExp(`${unit.building} ${unit.floor} ${unit.name}`) })).toBeVisible()

    for (const width of viewports) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      await documentDoesNotOverflow(page)

      const scrollableTables = await page.evaluate(() => (
        [...document.querySelectorAll('.overflow-x-auto')]
          .filter(element => element.scrollWidth > element.clientWidth)
          .length
      ))
      if (width === 390)
        expect(scrollableTables).toBeGreaterThan(0)
    }
    await expect(page.getByRole('region', { name: '全户合计' })).toBeVisible()
  })
  for (const input of draftCases) {
    test(`缺照片软卡取消时保留输入，确认后按原日期和备注保存草稿：${input.label}`, async ({ page }) => {
      test.setTimeout(60_000)
      await installQuantityProductionFixture(page)
      await expect(page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })).toBeVisible()
      const cell = page.getByRole('button', { name: new RegExp(`^${unit.floor}，${unit.name}；`) })
      await cell.focus()
      await cell.press('Enter')
      await page.getByRole('button', { name: `详情 ${unit.name}` }).click()

      await page.getByRole('region', { name: `${unit.trade}施工记录` }).locator('article').filter({ has: page.getByText(unit.stage, { exact: true }) }).getByRole('button', { name: '登记', exact: true }).click()
      const dialog = page.getByRole('dialog').filter({ hasText: '阶段完成登记' })
      const note = dialog.getByRole('textbox', { name: '备注' })
      await note.fill(input.note)
      await dialog.getByLabel('完成日期').fill(input.date)
      await expect(dialog.getByLabel('完成日期')).toHaveValue(input.date)

      await dialog.getByRole('button', { name: '登记完成', exact: true }).click()
      const softGate = page.getByRole('dialog').filter({ hasText: '缺少验收照片' })
      await expect(softGate).toBeVisible()
      await softGate.getByRole('button', { name: '取消', exact: true }).click()
      await expect(note).toHaveValue(input.note)

      await dialog.getByRole('button', { name: '登记完成', exact: true }).click()
      await softGate.getByRole('button', { name: '保存到草稿', exact: true }).click()
      await expect(page.getByText(/已保存.*草稿/)).toBeVisible()
      await expect(note).toHaveValue(input.note)
    })
  }
  for (const input of missingCases) {
    test(`直接访问工程量缺源显示错误态：${input.label}`, async ({ page }) => {
      const f = await installQuantityProductionFixture(page, { detailedStages: true })
      const projectId = input.missingProject ? 'missing-project' : f.projectId
      await page.goto(`/subcontract/quantity/${projectId}/not-a-unit?origin=real`)
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('alert').filter({ hasText: input.error })).toContainText(input.error)
    })
  }
})
