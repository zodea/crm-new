import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.describe('商务单据参考', () => {
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

    test('六类项目入口在各宽度无页面级横滚', async ({ page }) => {
      await page.goto('/project/project-real-320?origin=real')
      const journey = page.getByRole('region', { name: '项目商务单据' })
      await expect(journey.getByRole('link')).toHaveCount(9, { timeout: 20_000 })
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        for (const name of ['甲方变洽签', '月度报量', '竣工验收', '保修管理', '最终结算', '甲方罚扣'])
          await expect(journey.getByRole('link', { name: new RegExp(name) }), `${name} @ ${width}px`).toBeVisible()
        await expectNoPageOverflow(page, `#283 项目甲方六类入口 @ ${width}px`)
      }
    })
  })
})

test.describe('月度商务单据', () => {
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
      const ownerJourney = page.getByRole('region', { name: '项目商务单据' })
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

    test('专属详情在各宽度无页面级横滚，量价表在窄屏独立滚动', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/owner/report/report-real-323?origin=real')
      await expect(page.getByTestId('owner-commercial-document-detail')).toBeVisible({ timeout: 20_000 })
      const scroll = page.getByTestId('owner-document-lines-scroll')
      await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      await expect(scroll).toHaveAttribute('role', 'region')
      await expect(scroll).toHaveAttribute('aria-label', '报量与审定明细，可横向滚动查看完整列')
      await scroll.focus()
      await expect(scroll).toBeFocused()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#323 甲方月度报量详情 @ ${width}px`)
      }
    })
  })
})

test.describe('验收保修', () => {
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

    test('项目以同一 ID 进入保修视图并返回原上下文', async ({ page }) => {
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
    })

    test('施工合同以同一 ID 进入验收和保修双视图并返回原上下文', async ({ page }) => {
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
    })

    test('全局列表以同一 ID 进入保修视图并返回原上下文', async ({ page }) => {
      await page.goto('/owner/acceptance?origin=real&variant=warranty')
      await page.getByRole('link', { name: 'YS-2026-324' }).click()
      await expect(page).toHaveURL(/\/owner\/acceptance\/acceptance-real-324\?.*variant=warranty.*returnTo=/)
      await page.getByRole('link', { name: '返回验收·保修列表' }).click()
      await expect(page).toHaveURL(/\/owner\/acceptance\?.*variant=warranty.*nav=/)
      await expect(page.getByRole('link', { name: 'YS-2026-324' })).toBeFocused()
    })

    test('上报验收、确认验收并进入保修后，两张列表回读同一单据及附件审计', async ({ page }) => {
      test.setTimeout(120_000)
      const no = 'YS-E2E-LIFECYCLE'
      await page.goto('/owner/acceptance/new')
      await page.getByTestId('owner-document-no').fill(no)
      await page.getByTestId('owner-document-name').fill('合成验收保修闭环')
      for (const [label, value] of [['检索项目', '中央正式施工项目'], ['检索施工合同', '既有中央施工合同']] as const) {
        await page.getByRole('combobox', { name: label, exact: true }).fill(value)
        await page.getByRole('option').filter({ hasText: value }).first().click()
      }
      await page.getByTestId('finance-attachment-input').setInputFiles({ name: '合成验收报告.pdf', mimeType: 'application/pdf', buffer: Buffer.from(cooperationPdfFixture('Acceptance report')) })
      await expect(page.getByRole('textbox', { name: '附件分类' })).toHaveValue('acceptance-report')

      const submitted = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents')
        && response.request().method() === 'POST' && response.request().postDataJSON().action === 'submit')
      await page.getByRole('button', { name: '保存并提交', exact: true }).click()
      await page.getByRole('dialog', { name: '提交' }).getByRole('button', { name: '提交', exact: true }).click()
      const submittedResponse = await submitted
      expect(submittedResponse.ok(), await submittedResponse.text()).toBe(true)
      const { id } = await submittedResponse.json() as { id: string }
      const detailPath = `/owner/acceptance/${id}`
      const transition = async (label: string, target: 'accepted' | 'warranty') => {
        const changed = page.waitForResponse((response) => {
          const request = response.request()
          if (!response.url().endsWith('/api/commands/owner-documents') || request.method() !== 'POST')
            return false
          const body = request.postDataJSON()
          return body.action === 'transition-acceptance' && body.target === target
        })
        await page.getByRole('button', { name: label, exact: true }).click()
        await page.getByRole('dialog', { name: label }).getByRole('button', { name: label, exact: true }).click()
        const response = await changed
        expect(response.ok(), await response.text()).toBe(true)
        expect(await response.json()).toMatchObject({ id })
        await expect(page.getByTestId('owner-acceptance-detail')).toBeVisible()
      }

      await page.goto(`${detailPath}?origin=real`)
      await page.getByTestId('owner-acceptance-process').click()
      await page.getByTestId('owner-document-acceptanceOrganization').fill('合成验收组')
      await page.getByTestId('owner-document-acceptancePerson').fill('合成经办人')
      await page.getByTestId('owner-document-acceptanceDate').fill('2026-09-01')
      await page.getByTestId('owner-document-acceptanceConclusion').fill('验收合格')
      await transition('确认验收', 'accepted')

      await page.getByTestId('owner-acceptance-process').click()
      await page.getByTestId('owner-document-warrantyOwner').fill('合成保修单位')
      await page.getByTestId('owner-document-warrantyStartDate').fill('2026-09-02')
      await page.getByTestId('owner-document-warrantyEndDate').fill('2028-09-01')
      await page.getByTestId('finance-attachment-input').setInputFiles({ name: '合成保修凭据.pdf', mimeType: 'application/pdf', buffer: Buffer.from(cooperationPdfFixture('Warranty evidence')) })
      await expect(page.getByRole('textbox', { name: '附件分类' })).toHaveValue('warranty-confirmation')
      await transition('进入保修', 'warranty')

      for (const variant of ['acceptance', 'warranty']) {
        await page.goto(`/owner/acceptance?origin=real&variant=${variant}`)
        const link = page.getByRole('link', { name: no, exact: true })
        await expect(link).toBeVisible()
        await link.click()
        await expect(page).toHaveURL(new RegExp(`${detailPath}\\?`))
        const filename = variant === 'acceptance' ? '合成验收报告.pdf' : '合成保修凭据.pdf'
        await expect(page.getByText(filename, { exact: true })).toBeVisible()
        const timeline = page.getByRole('list', { name: '验收生命周期审计记录' })
        await expect(timeline).toContainText('提交验收')
        await expect(timeline).toContainText('确认验收')
        await expect(timeline).toContainText('进入保修')
      }
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

    test('双视图在各宽度无页面级横滚，密集列表只在自身区域滚动', async ({ page }) => {
      const expectNoOverflowAcrossWidths = async (label: string) => {
        for (const width of RESPONSIVE_WIDTHS) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await expectNoPageOverflow(page, `#324 ${label} @ ${width}px`)
        }
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/owner/acceptance?origin=real&variant=warranty')
      const table = page.locator('[data-ui="owner-document-table"]')
      await expect(table).toBeVisible({ timeout: 20_000 })
      await expectLocalHorizontalScroll(table, '#324 保修列表 @ 390px')
      await expectNoOverflowAcrossWidths('保修列表')

      await page.goto('/owner/acceptance/acceptance-real-324?origin=real&variant=acceptance')
      await expect(page.getByTestId('owner-acceptance-detail')).toBeVisible({ timeout: 20_000 })
      await expectNoOverflowAcrossWidths('验收详情')
      await page.getByRole('button', { name: '保修到期确认' }).click()
      await expect(page.getByTestId('warranty-variant-facts')).toBeVisible()
      await expectNoOverflowAcrossWidths('保修详情')
    })
  })
})

test.describe('最终结算', () => {
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
    await page.getByRole('combobox', { name: label }).fill(option)
    await page.getByRole('option').filter({ hasText: option }).click()
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
      // 当前中央主合同 960,000 + 已确认补充协议 80,000；历史结算报审额保留 1,280,000。
      await expect(page.getByRole('group', { name: '变更后合同额' })).toContainText('¥1,040,000.00')
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

      await sources.getByRole('row', { name: /SK-2026-325/ }).getByRole('link', { name: '查看收款', exact: true }).click()
      await expect(page).toHaveURL(/\/finance\/receipt\/receipt-real-325\?origin=real&customerId=customer-real-320&returnTo=/)
      await expect(page.getByRole('heading', { name: 'SK-2026-325' })).toBeVisible()
      await expect(page.getByRole('group', { name: '登记金额' })).toContainText('¥900,000.00')
      const receiptBack = page.getByRole('link', { name: '返回来源页面', exact: true })
      await expect(receiptBack).toHaveAttribute('href', /\/owner\/final-settlement\/final-settlement-real-325\?.*#final-settlement-receipt-receipt-real-325$/)
      await receiptBack.click()
      await expect(page).toHaveURL(/\/owner\/final-settlement\/final-settlement-real-325\?origin=real/)
    })

    for (const input of [
      { label: '尚有收款差额', amount: '1250000', formatted: '¥1,250,000.00', gap: '350,000.00', date: '2026-09-12' },
      { label: '收款差额为零与闰日', amount: '900000', formatted: '¥900,000.00', gap: '0.00', date: '2028-02-29' },
    ]) {
      test(`最终结算草稿更正后提交，列表和合同回读金额与附件：${input.label}`, async ({ page }) => {
        await page.goto('/owner/final-settlement/new')
        await expect(page.getByRole('heading', { name: '新建 · 最终结算' })).toBeVisible({ timeout: 20_000 })
        await page.getByTestId('owner-document-name').fill('E2E 甲方最终结算')
        await chooseLookup(page, '检索项目', '中央正式施工项目')
        await chooseLookup(page, '检索施工合同', '既有中央施工合同')
        await expect(page.getByTestId('owner-document-changedContractAmount')).toContainText('1,040,000.00')
        await expect(page.getByTestId('owner-document-receivedAmount')).toContainText('900,000.00')
        await page.getByTestId('owner-document-settlementAmount').fill('1000000')
        await page.getByTestId('owner-document-submissionDate').fill(input.date)
        await page.getByTestId('owner-document-basis').fill('施工合同、已确认补充协议与结算书')
        await page.getByTestId('owner-document-differenceNote').fill('审定事实待甲方回传')
        await page.getByTestId('finance-attachment-input').setInputFiles({
          name: 'e2e-甲方最终结算书.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(cooperationPdfFixture('Synthetic final settlement')),
        })

        const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
        await page.getByRole('button', { name: '保存草稿', exact: true }).click()
        const savedResponse = await saved
        expect(savedResponse.ok(), await savedResponse.text()).toBe(true)
        const draft = await savedResponse.json() as { id: string }
        await page.goto(`/owner/final-settlement/${draft.id}?origin=real`)
        await page.getByTestId('final-settlement-edit').click()
        await expect(page.getByTestId('owner-document-settlementAmount')).toHaveValue('1000000')
        await page.getByTestId('owner-document-settlementAmount').fill(input.amount)
        await expect(page.getByTestId('owner-document-settlementReceiptGap')).toContainText(input.gap)
        await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交' }).click()
        const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
        await page.getByRole('dialog', { name: '提交' }).getByRole('button', { name: '提交', exact: true }).click()
        const response = await command
        expect(response.ok(), await response.text()).toBe(true)
        const body = await response.json() as { id: string }
        expect(body.id).toBe(draft.id)

        await expect(page).toHaveURL('/owner/final-settlement')
        await page.goto('/owner/final-settlement?origin=real&search=E2E')
        const entry = page.locator(`a[href^="/owner/final-settlement/${body.id}?"]`).first()
        await expect(page.getByRole('row').filter({ has: entry })).toContainText(input.formatted)
        await entry.click()
        await expect(page.getByRole('heading', { name: 'E2E 甲方最终结算' })).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('group', { name: '报审金额' })).toContainText(input.formatted)
        await expect(page.getByRole('group', { name: '审定金额' })).toContainText('未记录')
        await expect(page.getByRole('group', { name: '结算收款差额', exact: true }).getByText(`¥${input.gap}`, { exact: true })).toBeVisible()
        await expect(page.getByText('e2e-甲方最终结算书.pdf')).toBeVisible()
        await expect(page.getByTestId('final-settlement-edit')).toHaveCount(0)
        await page.reload()
        await expect(page.getByRole('heading', { name: 'E2E 甲方最终结算' })).toBeVisible()
        await page.goto('/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements')
        const contractRow = page.getByRole('row').filter({ hasText: 'E2E 甲方最终结算' })
        await expect(contractRow).toContainText(input.formatted)
      })
    }

    test('错类型稳定 ID 显示关系不匹配，而不是普通读取失败', async ({ page }) => {
      await page.goto('/owner/final-settlement/acceptance-real-324?origin=real')
      const mismatch = page.getByRole('alert')
      await expect(mismatch.getByRole('heading', { name: '单据来源或类型不匹配' })).toBeVisible({ timeout: 20_000 })
      await expect(mismatch).toContainText('甲方商务单据类型与地址不匹配')
    })

    test('详情在各宽度无页面级横滚，来源表可键盘聚焦并在窄屏局部滚动', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/owner/final-settlement/final-settlement-real-325?origin=real')
      await expect(page.getByTestId('owner-final-settlement-detail')).toBeVisible({ timeout: 20_000 })
      const scroll = page.getByRole('region', { name: '最终结算来源单据，可横向滚动查看完整列' })
      await scroll.focus()
      await expect(scroll).toBeFocused()
      await expectLocalHorizontalScroll(scroll, '#325 来源表 @ 390px')
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#325 最终结算详情 @ ${width}px`)
      }
    })
  })
})

test.describe('甲方罚扣', () => {
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

    test('甲方罚扣草稿更正后提交，列表、合同与详情回读罚扣事实和附件', async ({ page }) => {
      await page.goto('/owner/penalty/new')
      await expect(page.getByRole('heading', { name: '新建 · 甲方罚扣单' })).toBeVisible({ timeout: 20_000 })
      await chooseLookup(page, '检索项目', '中央正式施工项目')
      await chooseLookup(page, '检索施工合同', '既有中央施工合同')
      await page.getByTestId('owner-document-noticeNo').fill('LX-E2E-326')
      await page.getByTestId('owner-document-amount').fill('16800')
      await page.getByTestId('owner-document-penaltyDate').fill('2026-08-26')
      await page.getByTestId('owner-document-reason').fill('E2E 现场进度罚扣')
      await page.getByTestId('owner-document-appealNote').fill('拟补充现场签证证据')
      await page.getByTestId('finance-attachment-input').setInputFiles({
        name: 'e2e-甲方联系单.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('issue-326-owner-penalty'),
      })

      const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
      await page.getByRole('button', { name: '保存草稿', exact: true }).click()
      const savedResponse = await saved
      expect(savedResponse.ok(), await savedResponse.text()).toBe(true)
      const draft = await savedResponse.json() as { id: string }
      await page.goto(`/owner/penalty/${draft.id}?origin=real`)
      await page.getByTestId('owner-penalty-edit').click()
      await expect(page.getByTestId('owner-document-amount')).toHaveValue('16800')
      await expect(page.getByTestId('owner-document-appealNote')).toHaveValue('拟补充现场签证证据')
      await page.getByTestId('owner-document-amount').fill('26800')
      await page.getByTestId('owner-document-appealNote').fill('已提交现场签证与工期顺延证据')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交' }).click()
      const command = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
      await page.getByRole('dialog', { name: '提交' }).getByRole('button', { name: '提交', exact: true }).click()
      const response = await command
      expect(response.ok(), await response.text()).toBe(true)
      const body = await response.json() as { id: string }
      expect(body.id).toBe(draft.id)

      await expect(page.getByRole('heading', { name: 'E2E 现场进度罚扣' })).toBeVisible()
      await page.goto('/owner/penalty?origin=real&search=LX-E2E-326')
      const entry = page.locator(`a[href^="/owner/penalty/${body.id}?"]`).first()
      await expect(page.getByRole('row').filter({ has: entry })).toContainText('26,800.00')
      await entry.click()
      await expect(page.getByRole('heading', { name: 'E2E 现场进度罚扣' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('group', { name: '罚扣金额' })).toContainText('-¥26,800.00')
      await expect(page.getByText('LX-E2E-326')).toBeVisible()
      await expect(page.getByText('已提交现场签证与工期顺延证据')).toBeVisible()
      await expect(page.getByText('e2e-甲方联系单.pdf')).toBeVisible()
      await expect(page.getByTestId('owner-penalty-edit')).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'E2E 现场进度罚扣' })).toBeVisible()
      await page.goto('/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements')
      await expect(page.getByRole('row').filter({ hasText: 'E2E 现场进度罚扣' })).toContainText('26,800.00')
    })

    test('草稿罚扣编辑取消保留来源，正式删除命令后列表及汇总同步', async ({ page }, testInfo) => {
      test.setTimeout(60_000)
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
      const body = await response.json() as { id: string, version: string }
      await expect(page).toHaveURL(new RegExp(`/owner/penalty/form/${body.id}`))

      const contractPath = '/contract/construction-contract-existing-320?origin=real&contractKind=construction&tab=settlements'
      const source = `${contractPath}&focus=${body.id}`
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

      await page.goto('/owner/penalty?origin=real&search=LX-DRAFT-326')
      const row = page.getByRole('row').filter({ has: page.locator(`a[href^="/owner/penalty/${body.id}?"]`) })
      await expect(row).toContainText('16,800.00')
      const summary = page.locator('[data-ui="owner-document-summary"]')
      await expect(summary).toContainText('16,800.00')
      await row.getByRole('button', { name: /操作$/ }).click()
      const menu = page.getByRole('menu', { name: /甲方罚扣单操作$/ })
      await expect(menu.getByRole('menuitem', { name: '查看详情' })).toBeVisible()
      await expect(menu.getByRole('menuitem', { name: '删除', exact: true })).toHaveCount(0)
      const { workspaceId, actorId, requiredCapability } = response.request().postDataJSON()
      const deletion = await page.request.post('/api/commands/owner-documents', {
        headers: { 'x-ruihang-test-session': session(testInfo) },
        data: { workspaceId, actorId, requiredCapability, kind: 'owner_penalty', action: 'delete', commandId: `delete-${body.id}`, id: body.id, baseVersion: body.version },
      })
      expect(deletion.ok(), await deletion.text()).toBe(true)
      expect(await deletion.json()).toMatchObject({ id: body.id, deleted: true })
      await page.reload()
      await expect(page.getByRole('status', { name: '没有符合条件的甲方罚扣单', exact: true })).toBeVisible()
      await expect(row).toHaveCount(0)
      await expect(summary.getByText('0', { exact: true })).toBeVisible()
      await expect(summary.getByText('¥0.00', { exact: true })).toBeVisible()
      await page.goto(contractPath)
      await expect(page.getByRole('link', { name: '施工进度延误', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'E2E 草稿罚扣' })).toHaveCount(0)
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
})
