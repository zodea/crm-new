import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function expectNoDocumentOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    rootClient: document.documentElement.clientWidth,
    rootScroll: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
  }))
  expect(widths.rootScroll).toBeLessThanOrEqual(widths.rootClient)
  expect(widths.bodyScroll).toBeLessThanOrEqual(widths.viewport)
}

async function hasLocalHorizontalScroller(
  region: import('@playwright/test').Locator,
): Promise<boolean> {
  return region.evaluate(root =>
    Array.from(root.querySelectorAll<HTMLElement>('*')).some((element) => {
      const style = getComputedStyle(element)
      return element.scrollWidth > element.clientWidth + 1
        && /auto|scroll/.test(style.overflowX)
    }),
  )
}

test('项目驾驶舱与正式源事实同口径，并提供只读来源穿透', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.goto('/project/proj_demo_001')
  await page.waitForLoadState('networkidle')

  const operation = page.locator('section[aria-labelledby="project-operation-title"]')
  await expect(operation.getByRole('group', { name: '确认支付' })).toContainText('¥4,200,000.00')
  await expect(operation.getByRole('group', { name: '管理费' })).toContainText('—')
  await expect(operation.getByRole('group', { name: '已知资金余额' })).toBeVisible()

  await page.getByRole('tab', { name: '施工合同管理', exact: true }).click()
  const construction = page.getByRole('region', { name: '施工合同', exact: true })
  const constructionSource = construction.getByRole('link', { name: '合和新城施工总承包合同' }).first()
  await expect(constructionSource).toHaveAttribute('href', '/contract/con_demo_sg01')
  await expect(construction.getByText('正式含税合同金额合计')).toContainText('¥32,388,422.00')
  await expect(
    construction.getByRole('button', { name: /新增|编辑|删除|确认|审批|归档/ }),
  ).toHaveCount(0)

  const supplement = page.getByRole('region', { name: '补充协议', exact: true })
  await expect(supplement.getByRole('link', { name: '材料调价补充协议' }).first())
    .toHaveAttribute('href', '/contract/con_demo_sg01')

  const ownerChange = page.getByRole('region', { name: '甲方变洽签', exact: true })
  await expect(ownerChange.getByRole('link', { name: 'BQ-2026-001' }).first())
    .toHaveAttribute('href', '/owner/change/oco_mz0x1_0')
  await expect(ownerChange.getByText('正式含税审定金额合计')).toContainText('¥120,520.00')

  await page.getByRole('tab', { name: '票税管理', exact: true }).click()
  const outgoing = page.getByRole('region', { name: '开票申请', exact: true })
  await expect(outgoing.getByRole('link', { name: '2026年6月进度开票申请' }).first())
    .toHaveAttribute('href', '/finance/billing/ia_mz0x1_0')
  await expect(outgoing.getByText('正式开票金额合计')).toContainText('¥25,663,629.00')

  await page.getByRole('tab', { name: '资金管理', exact: true }).click()
  const receipts = page.getByRole('region', { name: '收款登记', exact: true })
  await expect(receipts.getByRole('link', { name: 'SK-2026-001' }).first())
    .toHaveAttribute('href', '/finance/receipt/rr_mz0x1_0')
  await expect(receipts.getByText('正式收款金额合计')).toContainText('¥25,367,027.00')

  const applications = page.getByRole('region', { name: '付款申请', exact: true })
  await expect(applications.getByRole('link', { name: 'FK-2026-001' }).first())
    .toHaveAttribute('href', '/finance/payment/pa_mz0x1_0/detail')
  await expect(applications.getByText('已付金额合计')).toContainText('¥4,200,000.00')

  expect(pageErrors, '跨页签来源穿透旅程不应产生客户端运行错误').toEqual([])
})

const VIEWPORTS = [
  { label: '390px', width: 390, height: 844, expectLocalScroll: true },
  { label: '768px', width: 768, height: 900, expectLocalScroll: true },
  { label: '1024px', width: 1024, height: 900, expectLocalScroll: false },
  { label: '1440px', width: 1440, height: 1000, expectLocalScroll: false },
  // 1440px 物理窗口在浏览器 200% 缩放时，等效布局视口约为 720 CSS px。
  { label: '1440px @ 200%', width: 720, height: 900, expectLocalScroll: true },
] as const

for (const viewport of VIEWPORTS) {
  test(`${viewport.label} 项目详情不产生页面级横滚，密集表格保持局部滚动与键盘可达`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/project/proj_demo_001')
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: '施工合同管理', exact: true }).click()
    const construction = page.getByRole('region', { name: '施工合同', exact: true })
    await expect(construction).toBeVisible()
    await expectNoDocumentOverflow(page)

    if (viewport.expectLocalScroll)
      expect(await hasLocalHorizontalScroller(construction)).toBe(true)

    const source = construction.getByRole('link', { name: '合和新城施工总承包合同' }).first()
    await source.focus()
    await expect(source).toBeFocused()

    await page.getByRole('tab', { name: '票税管理', exact: true }).click()
    await expect(page.getByRole('region', { name: '开票申请', exact: true })).toBeVisible()
    await expectNoDocumentOverflow(page)

    await page.getByRole('tab', { name: '竣工验收及保修', exact: true }).click()
    await expect(page.getByRole('region', { name: '竣工验收与保修', exact: true })).toBeVisible()
    await expectNoDocumentOverflow(page)
  })
}
