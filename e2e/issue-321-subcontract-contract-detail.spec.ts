import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'demo-forbidden'
const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, scenario: Scenario = 'ready') {
  const response = await request.post('/api/testing/subcontract-contracts/reset', { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id }, data: { scenario } })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #321：分包合同专属中央详情', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('七分区详情保留真实事实、独立 null 状态与材料缺关系空态', async ({ page }) => {
    await page.goto('/contract/subcontract?search=泥水班组')
    await expect(page.getByTestId('subcontract-contract-list')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('subcontract-summary-real')).toContainText('0 份')
    await expect(page.getByTestId('subcontract-summary-demo')).toContainText('1 份')
    await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')
    await expect(page.getByRole('link', { name: '陈家泥水班组' })).toHaveAttribute('href', '/base/supplier/sup_demo_006?origin=demo')
    await page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true }).click()
    await expect(page).toHaveURL(/contractKind=subcontract&returnTo=/)
    await expect(page.getByRole('tab')).toHaveCount(7)
    await expect(page.getByTestId('subcontract-settlement-status')).toHaveText('未记录')
    await expect(page.getByTestId('subcontract-clearance-status')).toHaveText('未记录')
    await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')

    await page.getByRole('tab', { name: '分包变洽签' }).click()
    await expect(page.getByText('劳务范围补充协议')).toBeVisible()
    await expect(page.getByRole('link', { name: '劳务范围补充协议' })).toHaveAttribute('href', /tab=changes&focus=sub-supplement-1/)
    await expect(page.getByRole('link', { name: '样板层范围调整' })).toHaveCount(0)
    await page.getByRole('tab', { name: '收票登记' }).click()
    await expect(page.getByRole('link', { name: '劳务收票登记' })).toHaveAttribute('href', '/finance/invoice/sub-invoice-1')
    await page.getByRole('tab', { name: '付款' }).click()
    await expect(page.getByRole('link', { name: '五月进度付款申请' })).toHaveAttribute('href', '/finance/payment/sub-application-1/detail')
    await expect(page.getByRole('link', { name: '五月劳务支付' })).toHaveCount(0)
    await page.getByRole('tab', { name: '结算' }).click()
    await expect(page.getByText('五月过程结算')).toBeVisible()
    await expect(page.getByText('样板层完工结算')).toBeVisible()
    await page.getByRole('tab', { name: '材料领用' }).click()
    await expect(page.getByTestId('subcontract-material-uses')).toContainText('暂无材料使用记录')
    await expect(page.getByTestId('subcontract-material-uses').getByRole('link')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('subcontract-material-uses')).toContainText('材料使用记录尚未关联到此合同。')
  })

  test('正式分包合同经中央命令新建、编辑、详情和刷新闭合', async ({ page }, testInfo) => {
    const ownName = '分包验收已核实签约主体'
    const ownId = await createVerifiedSignatory(page, ownName, session(testInfo))
    await page.goto('/contract/subcontract/form')
    await expect(page.getByRole('heading', { name: /新建 · 分包合同/ })).toBeVisible({ timeout: 20_000 })
    await selectVerifiedSignatory(page, ownId, ownName)
    await page.getByLabel('合同名称 *').fill('中央正式劳务分包')
    await page.getByRole('combobox', { name: '检索项目' }).click()
    await page.getByText('中央正式施工项目', { exact: true }).click()
    await page.getByRole('combobox', { name: '检索分供方' }).click()
    await page.getByText('中央正式劳务分供方', { exact: true }).click()
    await page.getByLabel('合同内容简述 *').fill('正式劳务分包范围')
    await page.getByLabel('签约日期 *').fill('2026-08-25')
    const created = page.waitForResponse(response => response.url().endsWith('/api/commands/subcontract-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await created).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式劳务分包' })).toBeVisible()
    await page.getByTestId('subcontract-contract-edit').click()
    await page.getByLabel('合同名称 *').fill('中央正式劳务分包（已编辑）')
    const updated = page.waitForResponse(response => response.url().includes('/api/commands/subcontract-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await updated).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式劳务分包（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式劳务分包（已编辑）' })).toBeVisible()
    await expect(page.getByTestId('contract-frozen-signatory')).toHaveText(ownName)
  })

  test('禁止态不泄露分包合同数据', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'forbidden')
    const probe = await page.request.get('/api/read/subcontract-contracts', { headers: { 'x-ruihang-test-session': id } })
    expect(probe.status()).toBe(403)
    expect(await probe.json()).toMatchObject({ data: { code: 'forbidden' } })
    await page.goto('/contract/subcontract')
    await expect(page.getByText('无权查看分包合同')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('泥水班组劳务分包合同')).toHaveCount(0)
  })

  test('真实空态、来源错配与失败重试保持不同语义', async ({ page }, testInfo) => {
    const id = session(testInfo)
    await reset(page.context().request, id, 'empty')
    await page.goto('/contract/subcontract')
    await expect(page.getByTestId('subcontract-contract-list-scroll').getByText('暂无分包合同').last()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('columnheader', { name: '完工审定' })).toBeVisible()

    await reset(page.context().request, id, 'ready')
    await page.goto('/contract/con_demo_fb01?origin=real&contractKind=subcontract')
    await expect(page.getByText('合同来源或类别不匹配')).toBeVisible({ timeout: 20_000 })

    await reset(page.context().request, id, 'unavailable')
    await page.goto('/contract/subcontract')
    await expect(page.getByText('分包合同读取失败')).toBeVisible({ timeout: 20_000 })
    await reset(page.context().request, id, 'ready')
    await page.getByRole('button', { name: '重新加载' }).click()
    await expect(page.getByText('泥水班组劳务分包合同')).toBeVisible()
  })

  test('从详情返回恢复筛选、分页尺寸、滚动位置与合同焦点', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 })
    await page.goto('/contract/subcontract?search=泥水&pageSize=20')
    const contractLink = page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true })
    await expect(contractLink).toBeVisible({ timeout: 20_000 })
    await contractLink.scrollIntoViewIfNeeded()
    const savedScroll = await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)
    expect(savedScroll).toBeGreaterThan(0)
    await contractLink.click()
    await page.getByRole('tab', { name: '分包变洽签' }).click()
    await page.getByRole('link', { name: '返回分包合同列表' }).click()
    await expect(page).toHaveURL(/\/contract\/subcontract\?search=%E6%B3%A5%E6%B0%B4&pageSize=20&nav=origin_/)
    await expect(page.getByLabel('搜索分包合同')).toHaveValue('泥水')
    await expect(page.getByLabel('每页数量')).toHaveValue('20')
    await expect(page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true })).toBeFocused()
    await expect.poll(() => page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)).toBe(savedScroll)
  })

  test('列表、详情与密集事实表在各宽度无页面级横滚', async ({ page }) => {
    const expectNoOverflowAcrossWidths = async (label: string) => {
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#321 ${label} @ ${width}px`)
      }
    }
    await page.goto('/contract/subcontract?search=泥水班组')
    await expect(page.getByTestId('subcontract-contract-list')).toBeVisible({ timeout: 20_000 })
    await expectNoOverflowAcrossWidths('分包合同列表')
    await page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true }).click()
    await expect(page.getByTestId('subcontract-contract-detail')).toBeVisible()
    await expectNoOverflowAcrossWidths('分包合同详情')
    await page.getByRole('tab', { name: '结算' }).click()
    await expectNoOverflowAcrossWidths('分包合同结算')
  })
})
