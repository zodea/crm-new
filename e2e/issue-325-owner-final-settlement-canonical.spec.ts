import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(
  request: APIRequestContext,
  id: string,
  domain: 'owner-documents' | 'construction-contracts' | 'customers',
) {
  const response = await request.post(`/api/testing/${domain}/reset`, {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario: 'ready' },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function chooseLookup(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByText(option, { exact: true }).click()
}

test.describe('Issue #325：甲方最终结算专属只读链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id, 'construction-contracts')
    await reset(page.context().request, id, 'customers')
    await reset(page.context().request, id, 'owner-documents')
  })

  test('施工合同、补充协议和收款事实按稳定 ID 往返最终结算', async ({ page }) => {
    await page.goto('/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements')
    await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '中央正式施工项目甲方最终结算' }).click()

    await expect(page).toHaveURL(/\/owner\/final-settlement\/final-settlement-real-325\?origin=real&returnTo=/)
    await expect(page.getByTestId('owner-final-settlement-detail')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('group', { name: '报审金额' })).toContainText('¥1,280,000.00')
    await expect(page.getByRole('group', { name: '审定金额' })).toContainText('未记录')
    await expect(page.getByRole('group', { name: '变更后合同额' })).toContainText('¥1,280,000.00')
    await expect(page.getByRole('group', { name: '累计收款' })).toContainText('¥900,000.00')
    await expect(page.getByRole('group', { name: '结算收款差额' })).toContainText('¥380,000.00')
    await expect(page.getByText('甲方最终结算书.pdf')).toBeVisible()

    await page.getByText('来源事实', { exact: true }).locator('..').getByRole('link', { name: '既有中央施工合同' }).click()
    await expect(page).toHaveURL(/\/contract\/construction-contract-existing-320\?.*tab=settlements.*focus=final-settlement-real-325.*returnTo=/)
    await expect(page.getByRole('link', { name: '中央正式施工项目甲方最终结算' })).toBeFocused()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/owner\/final-settlement\/final-settlement-real-325\?origin=real/)

    const sources = page.getByRole('region', { name: '最终结算来源单据，可横向滚动查看完整列' })
    await sources.getByRole('row', { name: /BC-2026-325/ }).getByRole('link', { name: '既有中央施工合同' }).click()
    await expect(page).toHaveURL(/\/contract\/construction-contract-existing-320\?.*tab=supplements.*focus=supplement-real-325.*returnTo=/)
    await expect(page.getByText('结算范围补充协议')).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).click()

    await sources.getByRole('row', { name: /SK-2026-325/ }).getByRole('link', { name: '甲方工程款收款' }).click()
    await expect(page).toHaveURL(/\/finance\/receipt\/receipt-real-325\?origin=real&customerId=customer-real-320&returnTo=/)
    await expect(page.getByRole('heading', { name: 'SK-2026-325' })).toBeVisible()
    await expect(page.getByRole('group', { name: '登记金额' })).toContainText('¥900,000.00')
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/owner\/final-settlement\/final-settlement-real-325\?origin=real/)
  })

  test('正式整页表单只经中央命令提交，刷新仍可读真实聚合与附件', async ({ page }) => {
    await page.goto('/owner/final-settlement/new')
    await expect(page.getByRole('heading', { name: '新建 · 最终结算' })).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('owner-document-name').fill('E2E 甲方最终结算')
    await chooseLookup(page, '检索项目', '中央正式施工项目')
    await chooseLookup(page, '检索施工合同', '既有中央施工合同')
    await expect(page.getByTestId('owner-document-changedContractAmount')).toContainText('1,280,000.00')
    await expect(page.getByTestId('owner-document-receivedAmount')).toContainText('900,000.00')
    await page.getByTestId('owner-document-settlementAmount').fill('1250000')
    await expect(page.getByTestId('owner-document-settlementReceiptGap')).toContainText('350,000.00')
    await page.getByTestId('owner-document-basis').fill('施工合同、已确认补充协议与结算书')
    await page.getByTestId('owner-document-differenceNote').fill('审定事实待甲方回传')
    await page.getByTestId('finance-attachment-input').setInputFiles({
      name: 'e2e-甲方最终结算书.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('issue-325-final-settlement'),
    })

    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交' }).click()
    const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('dialog', { name: '提交' }).getByRole('button', { name: '提交', exact: true }).click()
    const response = await command
    expect(response.ok(), await response.text()).toBe(true)
    const body = await response.json() as { id: string }

    await expect(page).toHaveURL('/owner/final-settlement')
    await page.goto(`/owner/final-settlement/${body.id}?origin=real`)
    await expect(page.getByRole('heading', { name: 'E2E 甲方最终结算' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('group', { name: '报审金额' })).toContainText('¥1,250,000.00')
    await expect(page.getByRole('group', { name: '审定金额' })).toContainText('未记录')
    await expect(page.getByText('e2e-甲方最终结算书.pdf')).toBeVisible()
    await expect(page.getByTestId('final-settlement-edit')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E 甲方最终结算' })).toBeVisible()
  })

  test('错类型稳定 ID 显示关系不匹配，而不是普通读取失败', async ({ page }) => {
    await page.goto('/owner/final-settlement/acceptance-real-324?origin=real')
    const mismatch = page.getByRole('alert')
    await expect(mismatch.getByRole('heading', { name: '单据来源或类型不匹配' })).toBeVisible({ timeout: 20_000 })
    await expect(mismatch).toContainText('甲方商务单据类型与地址不匹配')
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 详情无页面级横滚，来源表可键盘聚焦并局部滚动`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/owner/final-settlement/final-settlement-real-325?origin=real')
      await expect(page.getByTestId('owner-final-settlement-detail')).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#325 最终结算详情 @ ${width}px`)
      const scroll = page.getByRole('region', { name: '最终结算来源单据，可横向滚动查看完整列' })
      await scroll.focus()
      await expect(scroll).toBeFocused()
      if (width === 390) {
        await expectLocalHorizontalScroll(scroll, '#325 来源表 @ 390px')
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      }
    })
  }
})
