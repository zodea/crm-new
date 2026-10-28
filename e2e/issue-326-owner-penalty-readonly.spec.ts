import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(
  request: APIRequestContext,
  id: string,
  domain: 'owner-documents' | 'construction-contracts',
  scenario: Scenario = 'ready',
) {
  const response = await request.post(`/api/testing/${domain}/reset`, {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function chooseLookup(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByText(option, { exact: true }).click()
}

test.describe('Issue #326：甲方罚扣专属只读链', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id, 'construction-contracts')
    await reset(page.context().request, id, 'owner-documents')
  })

  test('施工合同与全局主编号均进入同一罚扣详情，并精确返回来源', async ({ page }) => {
    await page.goto('/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements')
    await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '施工进度延误' }).click()

    await expect(page).toHaveURL(/\/owner\/penalty\/owner-penalty-real-326\?origin=real&returnTo=/)
    await expect(page.getByTestId('owner-penalty-detail')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('group', { name: '罚扣金额' })).toContainText('-¥36,000.00')
    await expect(page.getByText('LX-2026-326')).toBeVisible()
    await expect(page.getByText('已提交工期顺延说明')).toBeVisible()
    await expect(page.getByText('甲方联系单.pdf')).toBeVisible()
    await expect(page.getByTestId('owner-penalty-edit')).toHaveCount(0)

    await page.getByText('来源事实', { exact: true }).locator('..').getByRole('link', { name: '既有中央施工合同' }).click()
    await expect(page).toHaveURL(/\/contract\/construction-contract-existing-320\?.*tab=settlements.*focus=owner-penalty-real-326.*returnTo=/)
    await expect(page.getByRole('link', { name: '施工进度延误' })).toBeFocused()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/owner\/penalty\/owner-penalty-real-326\?origin=real/)

    await page.goto('/owner/penalty?origin=real')
    const mainLink = page.getByRole('link', { name: 'FK-2026-326' })
    await expect(mainLink).toBeVisible({ timeout: 20_000 })
    await mainLink.click()
    await expect(page).toHaveURL(/\/owner\/penalty\/owner-penalty-real-326\?.*returnTo=/)
    await page.getByRole('link', { name: '返回甲方罚扣列表' }).click()
    await expect(page).toHaveURL(/\/owner\/penalty\?.*nav=/)
    await expect(page.getByRole('link', { name: 'FK-2026-326' })).toBeFocused()
  })

  test('正式整页表单经中央命令提交，详情与刷新保留罚扣事实和附件', async ({ page }) => {
    await page.goto('/owner/penalty/new')
    await expect(page.getByRole('heading', { name: '新建 · 甲方罚扣单' })).toBeVisible({ timeout: 20_000 })
    await chooseLookup(page, '检索项目', '中央正式施工项目')
    await chooseLookup(page, '检索施工合同', '既有中央施工合同')
    await page.getByTestId('owner-document-noticeNo').fill('LX-E2E-326')
    await page.getByTestId('owner-document-amount').fill('26800')
    await page.getByTestId('owner-document-penaltyDate').fill('2026-08-26')
    await page.getByTestId('owner-document-reason').fill('E2E 现场进度罚扣')
    await page.getByTestId('owner-document-appealNote').fill('已提交现场签证与工期顺延证据')
    await page.getByTestId('finance-attachment-input').setInputFiles({
      name: 'e2e-甲方联系单.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('issue-326-owner-penalty'),
    })

    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交' }).click()
    const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('dialog', { name: '提交' }).getByRole('button', { name: '提交', exact: true }).click()
    const response = await command
    expect(response.ok(), await response.text()).toBe(true)
    const body = await response.json() as { id: string }

    await expect(page).toHaveURL('/owner/penalty')
    await page.goto(`/owner/penalty/${body.id}?origin=real`)
    await expect(page.getByRole('heading', { name: 'E2E 现场进度罚扣' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('group', { name: '罚扣金额' })).toContainText('-¥26,800.00')
    await expect(page.getByText('LX-E2E-326')).toBeVisible()
    await expect(page.getByText('已提交现场签证与工期顺延证据')).toBeVisible()
    await expect(page.getByText('e2e-甲方联系单.pdf')).toBeVisible()
    await expect(page.getByTestId('owner-penalty-edit')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'E2E 现场进度罚扣' })).toBeVisible()
  })

  test('草稿罚扣显式编辑取消后恢复原详情与施工合同来源', async ({ page }) => {
    await page.goto('/owner/penalty/new')
    await expect(page.getByRole('heading', { name: '新建 · 甲方罚扣单' })).toBeVisible({ timeout: 20_000 })
    await chooseLookup(page, '检索项目', '中央正式施工项目')
    await chooseLookup(page, '检索施工合同', '既有中央施工合同')
    await page.getByTestId('owner-document-noticeNo').fill('LX-DRAFT-326')
    await page.getByTestId('owner-document-amount').fill('16800')
    await page.getByTestId('owner-document-penaltyDate').fill('2026-08-26')
    await page.getByTestId('owner-document-reason').fill('E2E 草稿罚扣')

    const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿' }).click()
    const response = await command
    expect(response.ok(), await response.text()).toBe(true)
    const body = await response.json() as { id: string }
    await expect(page).toHaveURL(new RegExp(`/owner/penalty/form/${body.id}`))

    const source = `/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements&focus=${body.id}`
    await page.goto(`/owner/penalty/${body.id}?origin=real&returnTo=${encodeURIComponent(source)}`)
    await expect(page.getByRole('heading', { name: 'E2E 草稿罚扣' })).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('owner-penalty-edit').click()
    await expect(page).toHaveURL(new RegExp(`/owner/penalty/form/${body.id}\\?origin=real&returnTo=`))
    await expect(page.getByTestId('owner-document-noticeNo')).toHaveValue('LX-DRAFT-326')

    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '取消' }).click()
    await expect(page).toHaveURL(new RegExp(`/owner/penalty/${body.id}\\?origin=real&returnTo=`))
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(source)
    await expect(page.getByRole('link', { name: 'E2E 草稿罚扣' })).toBeFocused()
  })

  test('空列表、无权限与错类型稳定 ID 分别呈现可测试状态', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'owner-documents', 'empty')
    await page.goto('/owner/penalty')
    await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无甲方罚扣单' })).toBeVisible({ timeout: 20_000 })

    await reset(page.context().request, id, 'owner-documents', 'forbidden')
    await page.goto('/owner/penalty/owner-penalty-real-326?origin=real')
    await expect(page.getByText('无权查看甲方罚扣')).toBeVisible({ timeout: 20_000 })

    await reset(page.context().request, id, 'owner-documents', 'ready')
    await page.goto('/owner/penalty/final-settlement-real-325?origin=real')
    await expect(page.getByText('单据来源或类型不匹配')).toBeVisible({ timeout: 20_000 })
  })

  test('列表与详情在各宽度无页面级横滚，密集宽表只在自身区域滚动', async ({ page }) => {
    const expectNoOverflowAcrossWidths = async (label: string) => {
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#326 ${label} @ ${width}px`)
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/owner/penalty?origin=real')
    const table = page.locator('[data-ui="owner-document-table"]')
    await expect(table).toBeVisible({ timeout: 20_000 })
    await table.focus()
    await expect(table).toBeFocused()
    await expectLocalHorizontalScroll(table, '#326 甲方罚扣列表 @ 390px')
    await expectNoOverflowAcrossWidths('甲方罚扣列表')

    await page.goto('/owner/penalty/owner-penalty-real-326?origin=real')
    await expect(page.getByTestId('owner-penalty-detail')).toBeVisible({ timeout: 20_000 })
    await expectNoOverflowAcrossWidths('甲方罚扣详情')
  })
})
