import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect as baseExpect, test } from '@playwright/test'

import { installContractEngineeringFixture, selectContractEngineeringFixture } from './helpers/contract-engineering-fixture'
import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const expect = baseExpect.configure({ timeout: 20_000 })

async function chooseLookup(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByText(option, { exact: true }).click()
}

async function createSubcontract(page: Page, name: string): Promise<string> {
  const ownName = `此流程已核实我方签约主体-${randomUUID()}`
  const ownId = await createVerifiedSignatory(page, ownName)
  await installContractEngineeringFixture(page, 'subcontract', '中央正式施工项目')
  await page.goto('/contract/subcontract/form')
  await expect(page.getByRole('heading', { name: /新建 · 分包合同/ })).toBeVisible({ timeout: 20_000 })
  await selectVerifiedSignatory(page, ownId, ownName)
  await page.getByLabel('合同名称 *').fill(name)
  await selectContractEngineeringFixture(page)
  await chooseLookup(page, '检索分供方', '中央正式劳务分供方')
  await page.getByLabel('合同内容简述 *').fill('E2E 正式劳务分包范围')
  await page.getByLabel('签约日期 *').fill('2026-08-25')
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/commands/subcontract-contracts') && response.request().method() === 'POST')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { id: string }).id
}

test.describe('AX03 项目罚扣真实结算抵扣', () => {
  test.beforeEach(async ({ page }, info) => {
    const sessionId = Buffer.from(`${info.testId}-${info.retry}`).toString('base64url')
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    for (const domain of ['projects', 'subcontract-contracts', 'owner-documents', 'crew-workers']) {
      const response = await page.request.post(`/api/testing/${domain}/reset`, {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId },
        data: { scenario: 'ready' },
      })
      expect(response.ok()).toBe(true)
    }
  })

  test('读取失败可重试，缺失与来源不匹配不显示写入口', async ({ page }) => {
    await page.route('**/api/read/owner-documents/project_penalty/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ data: { code: 'unavailable', message: '测试读取暂不可用', retryable: true, fieldErrors: {}, traceId: null } }) }))
    await page.goto('/project/penalty/missing-329?origin=real')
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
    await page.unroute('**/api/read/owner-documents/project_penalty/*')
    await page.getByRole('button', { name: '重新加载' }).click()
    await expect(page.getByRole('heading', { name: '项目罚扣不存在', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '结算抵扣', exact: true })).toHaveCount(0)
    await page.goto('/project/penalty/missing-329?origin=demo')
    await expect(page.getByRole('button', { name: '记录整改' })).toHaveCount(0)
  })

  async function createDeductedPenalty(page: Page) {
    const crewResponse = await page.request.post('/api/commands/crews', { data: {
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: 'crew:write',
      commandId: 'crew329',
      baseVersion: null,
      action: 'save',
      draft: { name: 'AX03 责任班组', trade: '泥工', contactName: '测试经办', contactPhone: '13800000001', capabilityTrades: ['泥工'], capabilityItems: [], defaultPayRatio: 0.8, rentSubsidyEnabled: false, mgmtFeeEnabled: false, assignmentLevel: 'worker', note: '', status: '' },
      attachments: {},
    } })
    expect(crewResponse.ok()).toBe(true)
    const contractName = 'AX03 罚扣来源合同'
    const contractId = await createSubcontract(page, contractName)
    await page.goto('/subcontract/settlement/new')
    for (const [label, option] of [['检索项目', '中央正式施工项目'], ['检索分供方', '中央正式劳务分供方'], ['检索分包合同', contractName]]) await chooseLookup(page, label!, option!)
    await page.getByTestId('owner-document-name').fill('AX03 真实结算')
    await page.getByTestId('owner-document-totalAmount').fill('2000')
    await page.getByTestId('owner-document-settlementDate').fill('2026-09-05')
    const confirmed = page.waitForResponse(r => r.url().endsWith('/api/commands/owner-documents') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '保存并确认', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    expect((await confirmed).ok()).toBe(true)
    await page.goto('/project/penalty/new')
    for (const [label, option] of [['检索项目', '中央正式施工项目'], ['检索分供方', '中央正式劳务分供方'], ['检索分包合同', contractName]]) await chooseLookup(page, label!, option!)
    await chooseLookup(page, '检索责任班组', 'AX03 责任班组')
    await page.getByTestId('owner-document-no').fill('AX03-FK')
    await page.getByTestId('owner-document-reason').fill('成品保护罚扣')
    await page.getByTestId('owner-document-amount').fill('1000')
    await page.getByTestId('owner-document-penaltyDate').fill('2026-09-05')
    const saved = page.waitForResponse(r => r.url().endsWith('/api/commands/owner-documents') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '提交', exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBe(true)
    const { id } = await response.json()
    await page.goto(`/project/penalty/form/${id}?origin=real`)
    await expect(page.getByTestId('owner-document-reason')).toBeVisible()
    await expect(page.getByRole('button', { name: '执行结算抵扣' })).toHaveCount(0)
    await page.goto('/project/penalty?search=AX03-FK&status=pending&pageSize=10')
    await page.getByRole('link', { name: 'AX03-FK', exact: true }).click()
    await expect(page.getByTestId('project-penalty-detail')).toBeVisible()
    await expect(page.getByRole('button', { name: '编辑罚扣' })).toHaveCount(0)
    for (const amount of ['400', '600']) {
      await page.getByRole('button', { name: '结算抵扣', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('combobox', { name: '检索真实分包结算' }).click()
      await page.getByRole('option', { name: /AX03 真实结算/ }).click()
      await dialog.getByLabel('本次抵扣金额').fill(amount)
      if (amount === '400') {
        let intercepted = false
        await page.route('**/api/commands/owner-documents', async (route) => {
          if (!intercepted && route.request().postDataJSON()?.action === 'deduct-penalty') {
            intercepted = true
            await route.fetch()
            await route.abort('failed')
          }
          else {
            await route.continue()
          }
        })
        await dialog.getByRole('button', { name: '确认抵扣' }).click()
        await expect(dialog.getByRole('alert')).toBeVisible()
        await expect(dialog.getByLabel('本次抵扣金额')).toHaveValue('400')
      }
      await dialog.getByRole('button', { name: '确认抵扣' }).click()
      await expect(dialog).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('group', { name: '剩余可抵扣' })).toContainText(amount === '400' ? '600.00' : '0.00')
    }
    await expect(page.getByRole('table', { name: '抵扣历史' }).getByRole('row')).toHaveCount(3)
    await page.getByRole('button', { name: '记录整改' }).click()
    await page.getByRole('dialog').getByLabel('整改说明').fill('复查合格')
    await page.getByRole('dialog').getByRole('button', { name: '保存整改' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('penalty-rectification-history')).toContainText('复查合格')
    return { id, contractId }
  }

  test('从新建到两次抵扣，刷新余额、整改与来源返回', async ({ page }) => {
    test.setTimeout(180_000)
    const { id, contractId } = await createDeductedPenalty(page)
    await page.getByRole('link', { name: '返回项目罚扣列表' }).click()
    await expect(page.getByRole('searchbox', { name: '搜索罚扣编号 / 事由 / 责任对象' })).toHaveValue('AX03-FK')
    await page.goto(`/project/penalty/${id}?origin=real`)
    await page.getByText('责任班组', { exact: true }).locator('..').getByRole('link').click()
    await page.getByRole('link', { name: '返回项目罚扣' }).click()
    await expect(page.getByTestId('project-penalty-detail')).toBeVisible()
    await page.getByText('来源合同', { exact: true }).locator('..').getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(contractId))
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page.getByTestId('project-penalty-detail')).toBeVisible()
    await page.getByRole('table', { name: '抵扣历史' }).getByRole('link', { name: 'AX03 真实结算' }).first().click()
    await expect(page.getByRole('group', { name: '奖罚抵扣' })).toContainText('1,000.00')
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page.getByTestId('project-penalty-detail')).toBeVisible()
  })

  test('罚扣列表、表单、详情和整改浮层适配各视口', async ({ page }) => {
    test.setTimeout(180_000)
    const { id } = await createDeductedPenalty(page)
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/project/penalty?search=AX03-FK&status=done')
      await expect(page.getByRole('link', { name: 'AX03-FK', exact: true })).toBeVisible()
      await expectNoPageOverflow(page, `罚扣列表 ${width}px`)
      await page.goto('/project/penalty/new')
      await expect(page.getByTestId('owner-document-reason')).toBeVisible()
      await expectNoPageOverflow(page, `罚扣表单 ${width}px`)
      await page.goto(`/project/penalty/${id}?origin=real`)
      await expect(page.getByRole('button', { name: '记录整改' })).toBeVisible()
      await expectNoPageOverflow(page, `罚扣详情 ${width}px`)
      if (width === 390)
        await expectLocalHorizontalScroll(page.getByTestId('penalty-history-scroll'), `抵扣历史 ${width}px`)
      const trigger = page.getByRole('button', { name: '记录整改' })
      await trigger.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      for (let step = 0; step < 9; step++) {
        await page.keyboard.press('Tab')
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      }
      await expectNoPageOverflow(page, `整改浮层 ${width}px`)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
    }
  })
})
