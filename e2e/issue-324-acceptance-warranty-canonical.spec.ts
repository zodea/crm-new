import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function resetOwnerDocuments(request: APIRequestContext, id: string) {
  const response = await request.post('/api/testing/owner-documents/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario: 'ready' },
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

test.describe('Issue #324：验收—保修 canonical 双视图', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await resetConstructionContracts(page.context().request, id)
    await resetOwnerDocuments(page.context().request, id)
  })

  test('项目、施工合同与全局列表均以同一 ID 进入双视图并返回原上下文', async ({ page }) => {
    await page.goto('/project/project-real-320?origin=real')
    await expect(page.getByRole('heading', { name: '中央正式施工项目' })).toBeVisible({ timeout: 20_000 })
    const projectJourney = page.getByRole('region', { name: '项目商务单据' })
    await expect(projectJourney.getByRole('link', { name: /竣工验收/ })).toBeVisible()
    await projectJourney.getByRole('link', { name: /保修管理/ }).click()
    await expect(page).toHaveURL(/\/owner\/acceptance\?.*projectId=project-real-320.*variant=warranty/)
    await expect(page.getByRole('link', { name: '返回来源详情' })).toBeVisible()
    await page.getByRole('link', { name: 'YS-2026-324' }).click()
    await page.getByRole('link', { name: '返回验收·保修列表' }).click()
    await expect(page.getByRole('link', { name: '返回来源详情' })).toBeVisible()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/project\/project-real-320\?origin=real&ownerJourney=origin_[^#]+#project-owner-document-card-warranty/)
    await expect(projectJourney.getByRole('link', { name: /保修管理/ })).toBeFocused()

    const browserContractResponse = page.waitForResponse(response => response.url().includes('/api/read/construction-contracts/construction-contract-existing-320'))
    await page.goto('/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=acceptance')
    const browserContractDetail = await (await browserContractResponse).json() as { sections: { acceptance: { acceptances: unknown[], warranties: unknown[] } } }
    expect(browserContractDetail.sections.acceptance.acceptances).toHaveLength(1)
    expect(browserContractDetail.sections.acceptance.warranties).toHaveLength(1)
    await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '中央正式施工项目竣工验收' }).first().click()
    await expect(page).toHaveURL(/\/owner\/acceptance\/acceptance-real-324\?origin=real&variant=acceptance&returnTo=/)
    await expect(page.getByText('acceptance-real-324', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('建设、监理、施工联合验收组')).toBeVisible()
    await expect(page.getByText('竣工验收报告.pdf')).toBeVisible()
    await expect(page.getByText('保修跟踪清单.pdf')).toHaveCount(0)

    await page.getByRole('button', { name: '保修到期确认' }).click()
    await expect(page).toHaveURL(/variant=warranty/)
    await expect(page.getByText('瑞航建设工程有限公司')).toBeVisible()
    await expect(page.getByText('保修跟踪清单.pdf')).toBeVisible()
    await expect(page.getByText('竣工验收报告.pdf')).toHaveCount(0)
    await expect(page.getByRole('list', { name: '验收生命周期审计记录' })).toContainText('提交验收')
    await expect(page.getByRole('list', { name: '验收生命周期审计记录' })).toContainText('确认验收')
    await expect(page.getByRole('list', { name: '验收生命周期审计记录' })).toContainText('进入保修')

    await page.getByRole('link', { name: '返回验收·保修列表' }).click()
    await expect(page).toHaveURL(/\/contract\/construction-contract-existing-320\?.*tab=acceptance/)
    await expect(page.getByRole('link', { name: '中央正式施工项目竣工验收' }).first()).toBeFocused()

    await page.goto('/owner/acceptance?origin=real&variant=warranty')
    await page.getByRole('link', { name: 'YS-2026-324' }).click()
    await expect(page).toHaveURL(/\/owner\/acceptance\/acceptance-real-324\?.*variant=warranty.*returnTo=/)
    await page.getByRole('link', { name: '返回验收·保修列表' }).click()
    await expect(page).toHaveURL(/\/owner\/acceptance\?.*variant=warranty.*nav=/)
    await expect(page.getByRole('link', { name: 'YS-2026-324' })).toBeFocused()
  })

  test('保修到期只经显式生命周期命令追加审计并锁定终态', async ({ page }) => {
    await page.goto('/owner/acceptance/acceptance-real-324?origin=real&variant=warranty')
    await expect(page.getByTestId('owner-acceptance-detail')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('owner-acceptance-process').click()
    await expect(page).toHaveURL(/\/owner\/acceptance\/form\/acceptance-real-324\?.*returnTo=/)
    await expect(page.getByText('保修跟踪清单.pdf')).toBeVisible()
    await expect(page.getByText('竣工验收报告.pdf')).toHaveCount(0)

    await page.getByTestId('owner-document-warrantyConfirmationOrganization').fill('建设单位保修验收组')
    await page.getByTestId('owner-document-warrantyConfirmationDate').fill('2028-07-18')
    await page.getByTestId('owner-document-warrantyConfirmationNote').fill('保修责任履行完毕')
    await page.getByTestId('finance-attachment-input').setInputFiles({
      name: '保修到期确认单.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('issue-324-warranty-confirmation'),
    })
    await expect(page.getByRole('textbox', { name: '附件分类' })).toHaveValue('warranty-confirmation')
    await expect(page.getByRole('textbox', { name: '附件分类' })).toHaveAttribute('readonly')
    await page.getByRole('button', { name: '确认保修到期', exact: true }).click()
    const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('dialog', { name: '确认保修到期' }).getByRole('button', { name: '确认保修到期', exact: true }).click()
    const response = await command
    expect(response.ok(), await response.text()).toBe(true)

    await expect(page).toHaveURL('/owner/acceptance/acceptance-real-324?origin=real&variant=warranty')
    await expect(page.getByText('已到期', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('建设单位保修验收组')).toBeVisible()
    await expect(page.getByText('保修责任履行完毕')).toBeVisible()
    await expect(page.getByText('保修到期确认单.pdf')).toBeVisible()
    await expect(page.getByRole('list', { name: '验收生命周期审计记录' })).toContainText('确认保修到期')
    await expect(page.getByTestId('owner-acceptance-process')).toHaveCount(0)
  })

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 双视图无页面级横滚，密集列表只在自身区域滚动`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/owner/acceptance?origin=real&variant=warranty')
      const table = page.locator('[data-ui="owner-document-table"]')
      await expect(table).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#324 保修列表 @ ${width}px`)
      if (width === 390)
        await expectLocalHorizontalScroll(table, '#324 保修列表 @ 390px')

      await page.goto('/owner/acceptance/acceptance-real-324?origin=real&variant=acceptance')
      await expect(page.getByTestId('owner-acceptance-detail')).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#324 验收详情 @ ${width}px`)
      await page.getByRole('button', { name: '保修到期确认' }).click()
      await expect(page.getByTestId('warranty-variant-facts')).toBeVisible()
      await expectNoPageOverflow(page, `#324 保修详情 @ ${width}px`)
    })
  }
})
