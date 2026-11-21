import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installContractEngineeringFixture, selectContractEngineeringFixture } from './helpers/contract-engineering-fixture'
import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.describe('合同详情主旅程', () => {
  const demoContracts = [
    { domain: 'construction', id: 'con_demo_sg01', name: '合和新城施工总承包合同', no: 'RJ-HHXC-SG-2025001', amount: '¥32,388,422.00', status: '履约中', firstTab: '详细资料', nextTab: /^补充合同\s+1$/, scroll: 'construction-contract-fact-scroll' },
    { domain: 'material', id: 'con_demo_cg01', name: '瓷砖采购合同', no: 'RJ-HHXC-CG-2026001', amount: '¥3,580,000.00', status: '履约中', firstTab: '详细信息', nextTab: /^采购明细\s+2$/, scroll: 'material-contract-lines-scroll' },
  ] as const

  test.describe('合同专属详情的演示只读与响应式验收', () => {
    test.beforeEach(async ({ page }) => {
      await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `contract-detail-${randomUUID()}` })
      await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
      for (const contract of demoContracts) {
        const response = await page.request.post(`/api/testing/${contract.domain}-contracts/reset`, {
          headers: { 'x-ruihang-test-reset': '1' },
          data: { scenario: 'ready' },
        })
        expect(response.ok(), await response.text()).toBe(true)
      }
    })

    for (const contract of demoContracts) {
      test(`${contract.domain} 展示合同金额、状态和只读来源，各宽度不溢出`, async ({ page }) => {
        await page.goto(`/contract/${contract.id}?origin=demo&contractKind=${contract.domain}`)
        const heading = page.getByRole('heading', { name: contract.name, exact: true })
        await expect(heading).toBeVisible()
        await expect(page.getByText(contract.no, { exact: true }).first()).toBeVisible()
        await expect(page.locator('[data-ui="status-tag"]').filter({ hasText: contract.status }).first()).toBeVisible()
        await expect(page.getByText(contract.amount, { exact: true }).first()).toBeVisible()
        await expect(page.getByText('演示只读', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '编辑合同', exact: true })).toHaveCount(0)
        for (const width of RESPONSIVE_WIDTHS) {
          await page.setViewportSize({ width, height: 900 })
          await expect(heading).toBeVisible()
          await expectNoPageOverflow(page, `${contract.domain} 合同详情 @ ${width}px`)
        }
      })

      test(`窄窗 ${contract.domain} 专有页签支持键盘切换、刷新恢复和局部横滚`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(`/contract/${contract.id}?origin=demo&contractKind=${contract.domain}`)
        await page.getByRole('tab', { name: contract.firstTab, exact: true }).focus()
        await page.keyboard.press('ArrowRight')
        const nextTab = page.getByRole('tab', { name: contract.nextTab })
        await expect(nextTab).toHaveAttribute('aria-selected', 'true')
        await page.reload()
        await expect(nextTab).toHaveAttribute('aria-selected', 'true')
        const table = page.getByTestId(contract.scroll).first()
        const scroller = contract.domain === 'construction' ? table.locator('.vxe-table--body-inner-wrapper').first() : table
        await expectLocalHorizontalScroll(scroller, `${contract.domain} 合同专有明细表`)
        await expectNoPageOverflow(page, `${contract.domain} 合同详情窄窗`)
      })
    }

    test('施工关联单据保持核验后的入口，材料采购不出现甲方变洽签页签', async ({ page }) => {
      await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=settlements')
      await expect(page.getByText('2026 年 6 月月度报量', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '2026 年 6 月月度报量', exact: true })).toHaveCount(0)
      await page.getByRole('tab', { name: /^收款登记\s+1$/ }).click()
      await expect(page.getByRole('link', { name: '合和地产集团进度收款', exact: true })).toHaveAttribute('href', /\/finance\/receipt\/rr_mz0x1_0\?origin=demo&customerId=customer_demo_001/)
      await page.goto('/contract/con_demo_cg01?origin=demo&contractKind=material')
      await expect(page.getByRole('tab')).toHaveText([/^\s*详细信息\s*$/, /^\s*采购明细\s+2\s*$/, /^\s*补充协议\s+0\s*$/, /^\s*材料管理\s*$/, /^\s*发票登记\s+1\s*$/, /^\s*付款信息\s+1\s*$/, /^\s*支出结算\s+1\s*$/, /^\s*项目扣罚\s+1\s*$/])
      await expect(page.getByRole('tab', { name: /变洽签/ })).toHaveCount(0)
    })
  })
})

test.describe('施工及分包合同读取', () => {
  const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

  function session(testInfo: TestInfo) {
    return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
  }

  async function resetContracts(request: APIRequestContext, id: string) {
    for (const domain of ['construction', 'subcontract'] as const) {
      const response = await request.post(`/api/testing/${domain}-contracts/reset`, {
        headers: {
          'x-ruihang-test-reset': '1',
          'x-ruihang-test-session': id,
        },
        data: { scenario: 'ready' },
      })
      expect(response.ok()).toBe(true)
    }
  }

  test.describe('Issue #282：施工与分包合同专属只读详情', () => {
    test.beforeEach(async ({ page }, testInfo) => {
      const id = session(testInfo)
      await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
      await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
      await resetContracts(page.context().request, id)
    })

    test('两类合同列表只用稳定 ID 提供项目与交易对方入口', async ({ page }) => {
      await page.goto('/contract/construction?search=合和新城')
      const constructionList = page.getByTestId('construction-contract-list')
      await expect(constructionList).toBeVisible({ timeout: 20_000 })
      await expect(constructionList.getByRole('link', { name: '合和新城', exact: true })).toHaveAttribute(
        'href',
        '/project/proj_demo_001?origin=demo',
      )
      await expect(constructionList.getByRole('link', { name: '合和地产集团', exact: true })).toHaveAttribute(
        'href',
        '/base/customer/customer_demo_001?origin=demo',
      )

      await page.goto('/contract/subcontract?search=泥水班组')
      const subcontractList = page.getByTestId('subcontract-contract-list')
      await expect(subcontractList).toBeVisible({ timeout: 20_000 })
      await expect(subcontractList.getByRole('link', { name: '合和新城', exact: true })).toHaveAttribute(
        'href',
        '/project/proj_demo_001?origin=demo',
      )
      await expect(subcontractList.getByRole('link', { name: '陈家泥水班组', exact: true })).toHaveAttribute(
        'href',
        '/base/supplier/sup_demo_006?origin=demo',
      )
    })
  })
})

test.describe('施工合同详情', () => {
  type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'demo-forbidden'
  const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

  function session(testInfo: TestInfo) {
    return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
  }

  async function reset(request: APIRequestContext, id: string, scenario: Scenario = 'ready') {
    const response = await request.post('/api/testing/construction-contracts/reset', {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
      data: { scenario },
    })
    expect(response.ok()).toBe(true)
  }

  test.describe('Issue #320：施工合同专属中央详情', () => {
    test.beforeEach(async ({ page }, testInfo) => {
      const id = session(testInfo)
      await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
      await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
      await reset(page.context().request, id)
    })

    test('施工专属列表进入七分区详情，null 竣工事实与真实空态刷新保持', async ({ page }) => {
      await page.goto('/contract/construction?search=合和新城')
      await expect(page.getByTestId('construction-contract-list')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('实际竣工日期').first()).toBeVisible()
      await expect(page.getByText('未记录').first()).toBeVisible()
      await page.getByRole('link', { name: '合和新城施工总承包合同', exact: true }).click()
      await expect(page).toHaveURL(/\/contract\/con_demo_sg01\?origin=demo&contractKind=construction&returnTo=/)
      await expect(page.getByRole('tab')).toHaveCount(7)
      await expect(page.getByTestId('construction-actual-completion')).toHaveText('未记录')
      await expect(page.getByTestId('construction-actual-completion')).not.toHaveText('2025-09-01')
      await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')
      await expect(page.getByRole('link', { name: '合和地产集团' })).toHaveAttribute('href', '/base/customer/customer_demo_001?origin=demo')

      await page.getByRole('tab', { name: /补充合同/ }).click()
      await expect(page.getByText('材料调价补充协议')).toBeVisible()
      await page.getByRole('tab', { name: /甲方变洽签/ }).click()
      await expect(page.getByText('已审定甲方变洽签')).toBeVisible()
      await expect(page.getByRole('link', { name: '已审定甲方变洽签' })).toHaveCount(0)
      await page.getByRole('tab', { name: '验收结算' }).click()
      await expect(page.getByText('2026 年 6 月月度报量')).toBeVisible()
      await expect(page.getByRole('link', { name: '2026 年 6 月月度报量' })).toHaveCount(0)
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无最终结算' })).toBeVisible()
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无甲方罚扣' })).toBeVisible()
      await page.getByRole('tab', { name: '票税管理' }).click()
      await expect(page.getByText('2026年6月进度开票申请')).toBeVisible()
      await expect(page.getByRole('link', { name: '2026年6月进度开票申请' })).toHaveCount(0)
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无销项开票登记' })).toBeVisible()
      await page.reload()
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无销项开票登记' })).toBeVisible()
      await page.getByRole('tab', { name: /收款登记/ }).click()
      const receiptHref = await page.getByRole('link', { name: '合和地产集团进度收款' }).getAttribute('href')
      const receiptUrl = new URL(receiptHref!, 'https://crm.test')
      expect(receiptUrl.pathname).toBe('/finance/receipt/rr_mz0x1_0')
      expect(receiptUrl.searchParams.get('origin')).toBe('demo')
      expect(receiptUrl.searchParams.get('customerId')).toBe('customer_demo_001')
      expect(receiptUrl.searchParams.get('returnTo')).toBe('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=receipts#construction-contract-receipt-rr_mz0x1_0')
      await page.getByRole('tab', { name: '竣工验收及保修' }).click()
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无竣工验收记录' })).toBeVisible()
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无保修到期记录' })).toBeVisible()
    })

    test('既有正式合同从显式编辑保存后返回同一详情并可刷新', async ({ page }, testInfo) => {
      const ownName = '此历史合同本次明确核实我方主体'
      const ownId = await createVerifiedSignatory(page, ownName, session(testInfo))
      await page.goto('/contract/construction?search=既有中央')
      await page.getByRole('link', { name: '既有中央施工合同' }).click()
      await expect(page.getByRole('heading', { name: '既有中央施工合同' })).toBeVisible()
      await expect(page.getByTestId('construction-contract-boq')).toHaveAttribute('href', '/contract/boq?project=project-real-320&contract=construction-contract-existing-320')
      await page.getByRole('tab', { name: /收款登记/ }).click()
      await expect(page).toHaveURL(/tab=receipts/)
      await page.getByTestId('construction-contract-edit').click()
      await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央施工合同')
      await selectVerifiedSignatory(page, ownId, ownName)
      await page.getByLabel('合同名称 *').fill('既有中央施工合同（已编辑）')
      const saved = page.waitForResponse(response => response.url().includes('/api/commands/construction-contracts/') && response.request().method() === 'PUT')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      expect((await saved).ok()).toBe(true)
      await expect(page.getByRole('heading', { name: '既有中央施工合同（已编辑）' })).toBeVisible()
      await expect(page.getByRole('tab', { name: /收款登记/ })).toHaveAttribute('aria-selected', 'true')
      await page.reload()
      await expect(page.getByRole('heading', { name: '既有中央施工合同（已编辑）' })).toBeVisible()
    })

    test('BOQ 稳定目标不存在时保持原身份并显示不可用态', async ({ page }) => {
      await page.goto('/contract/boq?project=proj_demo_001&contract=con_demo_sg01')
      await expect(page.getByTestId('boq-workspace-header').getByRole('link', { name: '合和新城施工总承包合同' })).toBeVisible({ timeout: 20_000 })
      await page.getByRole('button', { name: '主合同管理' }).click()
      await page.locator('nav a[href="/contract/construction"]').click()
      await page.getByRole('searchbox', { name: '搜索施工合同' }).fill('既有中央')
      await expect(page).toHaveURL(/search=%E6%97%A2%E6%9C%89%E4%B8%AD%E5%A4%AE/)
      await page.getByRole('link', { name: '既有中央施工合同' }).click()
      await page.getByTestId('construction-contract-boq').click()

      await expect(page).toHaveURL(/\/contract\/boq\?project=project-real-320&contract=construction-contract-existing-320$/)
      await expect(page.getByText('指定的施工合同清单不可用')).toBeVisible()
      await expect(page.getByTestId('boq-workspace-header').getByRole('link', { name: '合和新城施工总承包合同' })).toHaveCount(0)
      await expect(page.getByTestId('boq-workspace-header').getByText('既有中央施工合同')).toHaveCount(0)
    })

    test('正式施工合同经中央命令新建、详情与刷新闭合', async ({ page }, testInfo) => {
      const ownName = '施工验收已核实签约主体'
      const ownId = await createVerifiedSignatory(page, ownName, session(testInfo))
      await page.goto('/contract/construction/form')
      await expect(page.getByRole('heading', { name: /新建 · 施工合同/ })).toBeVisible({ timeout: 20_000 })
      await selectVerifiedSignatory(page, ownId, ownName)
      await page.getByLabel('合同名称 *').fill('中央正式施工合同')
      await page.getByRole('combobox', { name: '检索项目' }).click()
      await page.getByText('中央正式施工项目').click()
      await page.getByRole('combobox', { name: '检索客户' }).click()
      await page.getByText('中央正式甲方客户').click()
      await page.getByLabel('合同内容简述 *').fill('正式住宅施工')
      await page.getByLabel('签约日期 *').fill('2026-08-24')
      const created = page.waitForResponse(response => response.url().endsWith('/api/commands/construction-contracts') && response.request().method() === 'POST')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      const createdResponse = await created
      expect(createdResponse.status(), await createdResponse.text()).toBeLessThan(400)
      await expect(page.getByRole('heading', { name: '中央正式施工合同' })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('heading', { name: '中央正式施工合同' })).toBeVisible()
      await expect(page.getByTestId('contract-frozen-signatory')).toHaveText(ownName)
    })

    test('列表与七分区详情在各宽度无页面级横滚', async ({ page }) => {
      const expectNoOverflowAcrossWidths = async (label: string) => {
        for (const width of RESPONSIVE_WIDTHS) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await expectNoPageOverflow(page, `#320 ${label} @ ${width}px`)
        }
      }
      await page.goto('/contract/construction?search=合和新城')
      await expect(page.getByTestId('construction-contract-list')).toBeVisible({ timeout: 20_000 })
      await expectNoOverflowAcrossWidths('施工合同列表')
      await page.getByRole('link', { name: '合和新城施工总承包合同', exact: true }).click()
      await expect(page.getByTestId('construction-contract-detail')).toBeVisible()
      await expectNoOverflowAcrossWidths('施工合同详情')
      await page.getByRole('tab', { name: '验收结算' }).click()
      await expectNoOverflowAcrossWidths('施工合同验收结算')
    })
  })
})

test.describe('分包合同详情', () => {
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
      await installContractEngineeringFixture(page, 'subcontract', '中央正式施工项目')
      await page.goto('/contract/subcontract/form')
      await expect(page.getByRole('heading', { name: /新建 · 分包合同/ })).toBeVisible({ timeout: 20_000 })
      await selectVerifiedSignatory(page, ownId, ownName)
      await page.getByLabel('合同名称 *').fill('中央正式劳务分包')
      await selectContractEngineeringFixture(page)
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
})

test.describe('补充协议焦点', () => {
  const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

  function session(testInfo: TestInfo) {
    return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
  }

  async function reset(request: APIRequestContext, id: string, kind: 'construction' | 'subcontract') {
    const response = await request.post(`/api/testing/${kind === 'construction' ? 'construction' : 'subcontract'}-contracts/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
      data: { scenario: 'ready' },
    })
    expect(response.ok()).toBe(true)
  }

  test.describe('Issue #322：补充协议稳定聚焦与来源恢复', () => {
    test.beforeEach(async ({ page }, testInfo) => {
      const id = session(testInfo)
      await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
      await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
      await reset(page.context().request, id, 'construction')
      await reset(page.context().request, id, 'subcontract')
    })

    test('施工补充协议从列表进入、稳定聚焦并恢复筛选、滚动与原合同焦点', async ({ page }) => {
      const sessionResponse = await page.request.get('/api/read/business-session')
      expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
      const { workspaceId, actorId } = await sessionResponse.json()
      const projectResponse = await page.request.post('/api/commands/projects', { data: {
        workspaceId,
        actorId,
        requiredCapability: 'project:write',
        commandId: randomUUID(),
        baseVersion: null,
        action: 'draft',
        draft: { name: '补充协议滚动验收项目', status: '筹备中' },
        attachments: {},
      } })
      expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
      const { id: projectId } = await projectResponse.json()
      for (const input of [
        { label: '01', date: '2026-09-12', amount: 100 },
        { label: '02', date: '2028-02-29', amount: 125.5 },
        { label: '03', date: '2026-09-13', amount: 250 },
        { label: '04', date: '2026-09-14', amount: 500 },
        { label: '05', date: '2026-09-15', amount: 750 },
        { label: '06', date: '2026-09-16', amount: 1000 },
      ]) {
        const response = await page.request.post('/api/commands/construction-contracts', { data: {
          workspaceId,
          actorId,
          requiredCapability: 'construction-contract:write',
          commandId: randomUUID(),
          baseVersion: null,
          action: 'draft',
          draft: { name: `合和新城滚动合同${input.label}`, projectId, signDate: input.date, amount: input.amount },
          attachments: {},
        } })
        expect(response.ok(), await response.text()).toBe(true)
        expect((await response.json()).id).toBeTruthy()
      }
      await page.setViewportSize({ width: 390, height: 420 })
      await page.goto('/contract/construction?search=合和新城&pageSize=20')
      const contractLink = page.getByRole('link', { name: '合和新城施工总承包合同', exact: true })
      await expect(contractLink).toBeVisible({ timeout: 20_000 })
      await contractLink.scrollIntoViewIfNeeded()
      const savedScroll = await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)
      expect(savedScroll).toBeGreaterThan(0)
      await contractLink.click()
      await page.getByRole('tab', { name: /补充合同/ }).click()
      await page.getByRole('link', { name: '材料调价补充协议' }).click()

      await expect(page).toHaveURL(/contractKind=construction&tab=supplements&focus=cs_demo_sg01_01/)
      await expect(page.locator('#construction-contract-fact-cs_demo_sg01_01')).toBeFocused()
      await page.getByRole('link', { name: '返回施工合同列表' }).click()

      await expect(page).toHaveURL(/\/contract\/construction\?search=%E5%90%88%E5%92%8C%E6%96%B0%E5%9F%8E&pageSize=20&nav=origin_/)
      await expect(page.getByLabel('搜索施工合同')).toHaveValue('合和新城')
      await expect(page.getByLabel('每页数量')).toHaveValue('20')
      await expect(page.getByRole('link', { name: '合和新城施工总承包合同', exact: true })).toBeFocused()
      await expect.poll(() => page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)).toBe(savedScroll)
    })

    test('分包补充协议从列表进入、稳定聚焦并恢复筛选、滚动与原合同焦点', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 420 })
      await page.goto('/contract/subcontract?search=泥水&pageSize=20')
      const contractLink = page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true })
      await expect(contractLink).toBeVisible({ timeout: 20_000 })
      await contractLink.scrollIntoViewIfNeeded()
      const savedScroll = await page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)
      expect(savedScroll).toBeGreaterThan(0)
      await contractLink.click()
      await page.getByRole('tab', { name: '分包变洽签' }).click()
      await page.getByRole('link', { name: '劳务范围补充协议' }).click()

      await expect(page).toHaveURL(/contractKind=subcontract&tab=changes&focus=sub-supplement-1/)
      await expect(page.locator('#subcontract-contract-fact-sub-supplement-1')).toBeFocused()
      await page.getByRole('link', { name: '返回分包合同列表' }).click()

      await expect(page).toHaveURL(/\/contract\/subcontract\?search=%E6%B3%A5%E6%B0%B4&pageSize=20&nav=origin_/)
      await expect(page.getByLabel('搜索分包合同')).toHaveValue('泥水')
      await expect(page.getByLabel('每页数量')).toHaveValue('20')
      await expect(page.getByRole('link', { name: '泥水班组劳务分包合同', exact: true })).toBeFocused()
      await expect.poll(() => page.locator('[data-shell-workspace]').evaluate(element => element.scrollTop)).toBe(savedScroll)
    })

    test('直接深链加载父合同，并区分补充协议父子错配和目标不存在', async ({ page }) => {
      await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=cs_demo_sg01_01')
      await expect(page.getByRole('heading', { name: '合和新城施工总承包合同' })).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#construction-contract-fact-cs_demo_sg01_01')).toBeFocused()

      await page.goto('/contract/con_demo_sg02?origin=demo&contractKind=construction&tab=supplements&focus=cs_demo_sg01_01')
      await expect(page.getByText('补充协议与施工合同不匹配')).toBeVisible({ timeout: 20_000 })

      await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=supplement-missing')
      await expect(page.getByText('补充协议不存在或已删除')).toBeVisible({ timeout: 20_000 })

      await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=sub-supplement-1')
      await expect(page.getByRole('heading', { name: '泥水班组劳务分包合同' })).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('#subcontract-contract-fact-sub-supplement-1')).toBeFocused()

      await page.goto('/contract/con_demo_fb02?origin=demo&contractKind=subcontract&tab=changes&focus=sub-supplement-1')
      await expect(page.getByText('补充协议与分包合同不匹配')).toBeVisible({ timeout: 20_000 })

      await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=supplement-missing')
      await expect(page.getByText('聚焦的分包合同事实不存在或已删除')).toBeVisible({ timeout: 20_000 })

      await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=%00')
      await expect(page.getByText('施工合同详情查询参数无效')).toBeVisible({ timeout: 20_000 })

      await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=%00')
      await expect(page.getByText('分包合同详情查询参数无效')).toBeVisible({ timeout: 20_000 })
    })

    test('两类补充协议聚焦后在各宽度无页面级横滚', async ({ page }) => {
      const expectNoOverflowAcrossWidths = async (label: string) => {
        for (const width of RESPONSIVE_WIDTHS) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
          await expectNoPageOverflow(page, `#322 ${label} @ ${width}px`)
        }
      }
      await page.goto('/contract/con_demo_sg01?origin=demo&contractKind=construction&tab=supplements&focus=cs_demo_sg01_01')
      await expect(page.locator('#construction-contract-fact-cs_demo_sg01_01')).toBeFocused({ timeout: 20_000 })
      await expectNoOverflowAcrossWidths('施工补充协议聚焦')

      await page.goto('/contract/con_demo_fb01?origin=demo&contractKind=subcontract&tab=changes&focus=sub-supplement-1')
      await expect(page.locator('#subcontract-contract-fact-sub-supplement-1')).toBeFocused({ timeout: 20_000 })
      await expectNoOverflowAcrossWidths('分包补充协议聚焦')
    })
  })
})
