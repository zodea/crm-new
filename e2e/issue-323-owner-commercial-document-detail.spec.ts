import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'demo-forbidden'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetOwnerDocuments(request: APIRequestContext, id: string, scenario: Scenario = 'ready') {
  const response = await request.post('/api/testing/owner-documents/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function resetConstructionContracts(request: APIRequestContext, id: string) {
  const response = await request.post('/api/testing/construction-contracts/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario: 'ready' },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

test.describe('Issue #323：甲方变洽签与月度报量专属中央详情', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await resetConstructionContracts(page.context().request, id)
    await resetOwnerDocuments(page.context().request, id)
  })

  test('施工合同主链穿透变洽签详情，保留来源 ID 并返回原分区', async ({ page }) => {
    await page.goto('/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=changes')
    await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('tab', { name: /甲方变洽签/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('link', { name: '首层机电管线变更' }).click()

    await expect(page).toHaveURL(/\/owner\/change\/change-real-323\?origin=real&returnTo=/)
    await expect(page.getByRole('heading', { name: '首层机电管线变更' })).toBeVisible()
    await expect(page.getByText('change-real-323', { exact: true })).toBeVisible()
    await expect(page.getByText('甲方签证单.pdf')).toBeVisible()
    await expect(page.getByText('变更量价明细')).toBeVisible()

    await page.getByText('来源单据').locator('..').getByRole('link', { name: '既有中央施工合同' }).click()
    await expect(page).toHaveURL(/\/contract\/construction-contract-existing-320\?.*tab=changes.*focus=change-real-323.*returnTo=/)
    await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/owner\/change\/change-real-323\?origin=real/)

    await page.getByRole('link', { name: '返回甲方变洽签' }).click()
    await expect(page).toHaveURL(/\/contract\/construction-contract-existing-320\?.*tab=changes/)
    await expect(page.getByRole('tab', { name: /甲方变洽签/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('月度报量同屏呈现自动量、申报量、审定量、核减差额与真实空附件', async ({ page }) => {
    await page.goto('/owner/report/report-real-323?origin=real')
    await expect(page.getByRole('heading', { name: '2026 年 8 月月度报量' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('columnheader', { name: '自动完成量' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '申报量' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '审定量' })).toBeVisible()
    await expect(page.getByRole('group', { name: '审定差额' })).toContainText('¥-520.00')
    await expect(page.getByText(/^暂无附件/)).toBeVisible()
    await expect(page.getByText('report-real-323')).toBeVisible()
    await expect(page.getByText('monthly-quantity-real-323-v1')).toBeVisible()
    await expect(page.getByText('2026-08-19T08:00:00.000Z')).toBeVisible()
  })

  test('项目详情提供变洽签与报量主链，关系下钻可返回原单据', async ({ page }) => {
    await page.goto('/project/project-real-320?origin=real')
    await expect(page.getByRole('heading', { name: '中央正式施工项目' })).toBeVisible({ timeout: 20_000 })
    const ownerJourney = page.getByRole('region', { name: '甲方变洽签与月度报量' })
    await expect(ownerJourney.getByRole('link', { name: /甲方变洽签/ })).toBeVisible()
    await ownerJourney.getByRole('link', { name: /月度报量/ }).click()
    await expect(page).toHaveURL(/\/owner\/report\?.*projectId=project-real-320/)
    await expect(page.getByRole('link', { name: '返回来源详情' })).toBeVisible()

    await page.goto('/owner/report/report-real-323?origin=real')
    await page.getByRole('link', { name: '中央正式甲方客户' }).click()
    await expect(page).toHaveURL(/\/base\/customer\/customer-real-320\?origin=real&returnTo=/)
    await expect(page.getByRole('heading', { name: '中央正式甲方客户' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).first().click()
    await expect(page).toHaveURL(/\/owner\/report\/report-real-323\?origin=real/)

    await page.getByRole('link', { name: '中央正式施工项目' }).click()
    await expect(page).toHaveURL(/\/project\/project-real-320\?origin=real&returnTo=/)
    await page.getByRole('link', { name: '返回来源详情' }).first().click()
    await expect(page).toHaveURL(/\/owner\/report\/report-real-323\?origin=real/)
  })

  test('正式整页表单只经中央命令新建变洽签，刷新详情仍可读', async ({ page }) => {
    await page.goto('/owner/change/new')
    await expect(page.getByRole('heading', { name: '新建 · 甲方变洽签' })).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('owner-document-name').fill('浏览器中央变洽签')
    await page.getByRole('combobox', { name: '检索项目' }).click()
    await page.getByText('中央正式施工项目', { exact: true }).click()
    await page.getByRole('combobox', { name: '检索施工合同' }).click()
    await page.getByText('既有中央施工合同', { exact: true }).click()
    await page.getByTestId('owner-document-reason').fill('验证正式命令、中央重算与专属详情')
    await page.getByTestId('owner-document-approvedTaxInclusiveAmount').fill('880')

    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并上报' }).click()
    const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('button', { name: '上报', exact: true }).click()
    const response = await command
    expect(response.ok(), await response.text()).toBe(true)
    const body = await response.json() as { id: string }

    await expect(page).toHaveURL('/owner/change', { timeout: 20_000 })
    await page.goto(`/owner/change/${body.id}?origin=real`)
    await expect(page.getByRole('heading', { name: '浏览器中央变洽签' })).toBeVisible()
    await expect(page.getByText(/\u00A5880\.00/)).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '浏览器中央变洽签' })).toBeVisible()
  })

  test('空列表、无权限与类型不匹配分别呈现真实状态', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await resetOwnerDocuments(page.context().request, id, 'empty')
    await page.goto('/owner/change')
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无甲方变洽签' })).toBeVisible({ timeout: 20_000 })

    await resetOwnerDocuments(page.context().request, id, 'forbidden')
    await page.goto('/owner/change/change-real-323?origin=real')
    await expect(page.getByText('无权查看该甲方变洽签')).toBeVisible()

    await resetOwnerDocuments(page.context().request, id, 'ready')
    await page.goto('/owner/report/change-real-323?origin=real')
    await expect(page.getByText('单据来源或类型不匹配')).toBeVisible()
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 专属详情无页面级横滚，量价表独立滚动`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/owner/report/report-real-323?origin=real')
      await expect(page.getByTestId('owner-commercial-document-detail')).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#323 甲方月度报量详情 @ ${width}px`)
      if (width === 390) {
        const scroll = page.getByTestId('owner-document-lines-scroll')
        await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
        await expect(scroll).toHaveAttribute('role', 'region')
        await expect(scroll).toHaveAttribute('aria-label', '报量与审定明细，可横向滚动查看完整列')
        await scroll.focus()
        await expect(scroll).toBeFocused()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      }
    })
  }
})
