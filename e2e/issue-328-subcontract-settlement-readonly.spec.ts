import type { Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect as baseExpect, test } from '@playwright/test'

import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const expect = baseExpect.configure({ timeout: 20_000 })

async function chooseLookup(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).fill(option)
  await page.getByRole('option').filter({ hasText: option }).first().click()
}

async function createSubcontract(page: Page, name: string): Promise<string> {
  const ownName = '此流程已核实我方签约主体'
  const ownId = await createVerifiedSignatory(page, ownName)
  await page.goto('/contract/subcontract/form')
  await expect(page.getByRole('heading', { name: /新建 · 分包合同/ })).toBeVisible({ timeout: 20_000 })
  await selectVerifiedSignatory(page, ownId, ownName)
  await page.getByLabel('合同名称 *').fill(name)
  await chooseLookup(page, '检索项目', '中央正式施工项目')
  await chooseLookup(page, '检索分供方', '中央正式劳务分供方')
  await page.getByLabel('合同内容简述 *').fill('E2E 正式劳务分包范围')
  await page.getByLabel('签约日期 *').fill('2026-08-25')
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/commands/subcontract-contracts') && response.request().method() === 'POST')
  await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
  const response = await responsePromise
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { id: string }).id
}

test.describe('AX02 分包结算中央只读链', () => {
  test.beforeEach(async ({ page }, info) => {
    const sessionId = Buffer.from(info.testId).toString('base64url')
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
    for (const domain of ['projects', 'subcontract-contracts', 'owner-documents']) {
      const response = await page.request.post(`/api/testing/${domain}/reset`, {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId },
        data: { scenario: 'ready' },
      })
      expect(response.ok()).toBe(true)
    }
  })

  test('保存确认后刷新仍保留结算与附件，列表、合同与项目往返恢复来源', async ({ page }) => {
    test.setTimeout(90_000)
    const contractName = 'E2E 分包结算合同 328'
    await createSubcontract(page, contractName)
    await page.goto('/subcontract/settlement/new')
    await expect(page.getByRole('heading', { name: '新建 · 分包结算' })).toBeVisible({ timeout: 20_000 })
    for (const [label, option] of [['检索项目', '中央正式施工项目'], ['检索分供方', '中央正式劳务分供方'], ['检索分包合同', contractName]]) {
      await chooseLookup(page, label!, option!)
    }
    await page.getByTestId('owner-document-no').fill('FBJS-E2E-328')
    await page.getByTestId('owner-document-name').fill('E2E 八月劳务结算')
    await page.getByTestId('owner-document-totalAmount').fill('28000')
    await page.getByTestId('owner-document-settlementDate').fill('2026-08-31')
    await page.getByTestId('finance-attachment-input').setInputFiles({ name: '结算确认单.pdf', mimeType: 'application/pdf', buffer: Buffer.from('AX02') })
    const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并确认' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBe(true)
    const { id } = await response.json()
    await page.goto('/subcontract/settlement?status=confirmed&search=FBJS-E2E-328&pageSize=10')
    for (const title of ['奖罚抵扣', '本次结算净额', '累计申请付款', '剩余可申请', '累计已付', '剩余未付']) {
      await expect(page.getByRole('columnheader', { name: title, exact: true })).toHaveCount(1)
    }
    const link = page.getByRole('link', { name: 'FBJS-E2E-328', exact: true })
    await link.click()
    await expect(page.getByRole('heading', { name: 'E2E 八月劳务结算' })).toBeVisible()
    await expect(page.getByRole('group', { name: '含税结算额' })).toContainText('¥28,000.00')
    await expect(page.getByTestId('subcontract-settlement-edit')).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('结算确认单.pdf')).toBeVisible()
    await page.getByRole('link', { name: '返回分包结算列表' }).click()
    await expect(link).toBeFocused()
    await expect(page.getByRole('searchbox', { name: '搜索结算编号 / 名称 / 分供方' })).toHaveValue('FBJS-E2E-328')

    await page.goto(`/subcontract/settlement/${id}?origin=real`)
    await page.getByText('来源单据', { exact: true }).locator('..').getByRole('link').click()
    await expect(page).toHaveURL(/tab=settlements/)
    await expect(page.getByRole('link', { name: 'E2E 八月劳务结算' })).toBeFocused()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(new RegExp(`/subcontract/settlement/${id}`))

    await page.goto('/project/project-real-320?origin=real')
    await page.locator('#project-owner-document-card-sub-settlement').click()
    await page.getByRole('button', { name: /^状态，已选 1 项$/ }).click()
    const status = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: '状态', exact: true }) })
    await status.getByRole('checkbox', { name: '待确认', exact: true }).uncheck()
    await status.getByRole('checkbox', { name: '已确认', exact: true }).check()
    await status.getByRole('button', { name: '应用', exact: true }).click()
    await page.getByRole('link', { name: 'FBJS-E2E-328', exact: true }).click()
    await page.getByRole('link', { name: '返回分包结算列表' }).click()
    await page.getByRole('link', { name: '返回来源详情' }).click()
    await expect(page).toHaveURL(/\/project\/project-real-320/)
    await expect(page.locator('#project-owner-document-card-sub-settlement')).toBeFocused()
  })

  test('空态、无权限、错配和失败重试可判别', async ({ page }, info) => {
    const sessionId = Buffer.from(info.testId).toString('base64url')
    const reset = (scenario: string) => page.request.post('/api/testing/owner-documents/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId }, data: { scenario } })
    await reset('empty')
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/subcontract/settlement')
    await expect(page.locator('[data-ui="kit-table-empty"]:visible')).toContainText('暂无分包结算')
    const emptyTitle = await page.locator('[data-ui="kit-table-empty"]:visible').getByText('暂无分包结算', { exact: true }).boundingBox()
    expect(emptyTitle).not.toBeNull()
    expect(emptyTitle!.x + emptyTitle!.width).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width: 1280, height: 900 })
    await reset('forbidden')
    await page.goto('/subcontract/settlement/sub-settlement-real-328?origin=real')
    await expect(page.getByText('无权查看分包结算')).toBeVisible()
    await reset('ready')
    await page.goto('/subcontract/settlement/sub-change-real-327?origin=real')
    await expect(page.getByText('单据来源或关系不匹配')).toBeVisible()
    await reset('unavailable')
    await page.goto('/subcontract/settlement/sub-settlement-real-328?origin=real')
    await expect(page.getByText('分包结算读取失败')).toBeVisible()
    await reset('ready')
    await page.getByRole('button', { name: '重新加载' }).click()
    await expect(page.getByRole('heading', { name: '中央正式八月分包结算' })).toBeVisible()
  })

  test('零金额草稿可查看，缺关系不猜接，只有显式编辑才进入独立表单', async ({ page }) => {
    const response = await page.request.post('/api/commands/owner-documents', { data: {
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: 'subcontract-document:write',
      commandId: 'draft-328',
      action: 'save',
      kind: 'sub_settlement',
      id: null,
      baseVersion: null,
      draft: { no: 'FBJS-DRAFT-328', name: '待核对分包结算', totalAmount: 0 },
      attachments: {},
    } })
    expect(response.ok(), await response.text()).toBe(true)
    const { id } = await response.json()
    await page.goto(`/subcontract/settlement/${id}?origin=real`)
    await expect(page.getByRole('group', { name: '含税结算额' })).toContainText('¥0.00')
    await expect(page.getByRole('link', { name: '分包合同不可用' })).toHaveCount(0)
    await page.getByRole('button', { name: '编辑结算' }).click()
    await expect(page).toHaveURL(new RegExp(`/subcontract/settlement/form/${id}`))
    await page.getByTestId('owner-document-name').fill('已补充名称的结算草稿')
    const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/owner-documents') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并确认' })).toBeEnabled()
    await page.reload()
    await expect(page.getByRole('heading', { name: '已补充名称的结算草稿' })).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('subcontract-settlement-edit').click()
    await expect(page.getByTestId('owner-document-name')).toHaveValue('已补充名称的结算草稿')
    await page.getByRole('button', { name: '返回来源', exact: true }).click()
    await expect(page.getByRole('heading', { name: '已补充名称的结算草稿' })).toBeVisible({ timeout: 20_000 })
    await page.reload()
    await expect(page.getByRole('heading', { name: '已补充名称的结算草稿' })).toBeVisible({ timeout: 20_000 })
  })

  test('列表与详情在各宽度无页面级横滚，局部滚动与键盘焦点', async ({ page }) => {
    const widths = [...RESPONSIVE_WIDTHS, 666, 1293]
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/subcontract/settlement?status=confirmed')
    const table = page.locator('[data-ui="owner-document-table"]')
    await expect(table).toBeVisible()
    await expect(page.getByRole('link', { name: 'FBJS-2026-328', exact: true })).toBeVisible()
    await table.focus()
    await expect(table).toBeFocused()
    await expectLocalHorizontalScroll(table, 'AX02 settlement list')
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `AX02 list ${width}`)
    }
    await page.goto('/subcontract/settlement/sub-settlement-real-328?origin=real')
    await expect(page.getByRole('heading', { name: '中央正式八月分包结算' })).toBeVisible()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `AX02 detail ${width}`)
    }
  })
})
