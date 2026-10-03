import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, domain: 'owner-documents' | 'projects') {
  const response = await request.post(`/api/testing/${domain}/reset`, {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario: 'ready' },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

test.describe('Issue #283：甲方六类单据专属只读详情与双视图', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id, 'projects')
    await reset(page.context().request, id, 'owner-documents')
  })

  test('项目按稳定 ID 提供六类入口，最终结算与罚扣可恢复原锚点、滚动和焦点', async ({ page }) => {
    await page.goto('/project/project-real-320?origin=real')
    await expect(page.getByRole('heading', { name: '中央正式施工项目' })).toBeVisible({ timeout: 20_000 })
    const journey = page.getByRole('region', { name: '项目商务单据' })
    for (const name of ['甲方变洽签', '月度报量', '竣工验收', '保修管理', '最终结算', '甲方罚扣'])
      await expect(journey.getByRole('link', { name: new RegExp(name) })).toBeVisible()

    const workspace = page.locator('[data-shell-workspace]')
    const finalSettlement = journey.getByRole('link', { name: /最终结算/ })
    await workspace.evaluate(element => element.scrollTop = Math.min(180, element.scrollHeight - element.clientHeight))
    await finalSettlement.focus()
    const finalSettlementScrollTop = await workspace.evaluate(element => element.scrollTop)
    expect(finalSettlementScrollTop).toBeGreaterThan(0)
    await finalSettlement.click()
    await expect(page).toHaveURL(/\/owner\/final-settlement\?.*projectId=project-real-320.*returnTo=/)
    await page.getByRole('link', { name: 'JS-2026-325' }).click()
    await expect(page.getByTestId('owner-final-settlement-detail')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '返回最终结算列表' }).click()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/project\/project-real-320\?origin=real&ownerJourney=origin_[^#]+#project-owner-document-card-final-settlement/)
    await expect(journey.getByRole('link', { name: /最终结算/ })).toBeFocused()
    await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(finalSettlementScrollTop)

    const penalty = journey.getByRole('link', { name: /甲方罚扣/ })
    await workspace.evaluate(element => element.scrollTop = Math.min(72, element.scrollHeight - element.clientHeight))
    await penalty.focus()
    const penaltyScrollTop = await workspace.evaluate(element => element.scrollTop)
    expect(penaltyScrollTop).toBeGreaterThan(0)
    await penalty.click()
    await expect(page).toHaveURL(/\/owner\/penalty\?.*projectId=project-real-320.*returnTo=/)
    await page.getByRole('link', { name: 'FK-2026-326' }).click()
    await expect(page.getByTestId('owner-penalty-detail')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '返回甲方罚扣列表' }).click()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/project\/project-real-320\?origin=real&ownerJourney=origin_[^#]+#project-owner-document-card-penalty/)
    await expect(journey.getByRole('link', { name: /甲方罚扣/ })).toBeFocused()
    await expect.poll(() => workspace.evaluate(element => element.scrollTop)).toBe(penaltyScrollTop)
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 六类项目入口无页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/project/project-real-320?origin=real')
      const journey = page.getByRole('region', { name: '项目商务单据' })
      await expect(journey.getByRole('link')).toHaveCount(9, { timeout: 20_000 })
      for (const name of ['甲方变洽签', '月度报量', '竣工验收', '保修管理', '最终结算', '甲方罚扣'])
        await expect(journey.getByRole('link', { name: new RegExp(name) })).toBeVisible()
      await expectNoPageOverflow(page, `#283 项目甲方六类入口 @ ${width}px`)
    })
  }
})
