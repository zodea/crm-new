import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

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
    for (const width of RESPONSIVE_WIDTHS) {
      test(`${width}px ${contract.domain} 展示合同金额、状态和只读来源`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/contract/${contract.id}?origin=demo&contractKind=${contract.domain}`)
        await expect(page.getByRole('heading', { name: contract.name, exact: true })).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText(contract.no, { exact: true }).first()).toBeVisible()
        await expect(page.locator('[data-ui="status-tag"]').filter({ hasText: contract.status }).first()).toBeVisible()
        await expect(page.getByText(contract.amount, { exact: true }).first()).toBeVisible()
        await expect(page.getByText('演示只读', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '编辑合同', exact: true })).toHaveCount(0)
        await expectNoPageOverflow(page, `${contract.domain} 合同详情 @ ${width}px`)
      })
    }

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
    await expect(page.getByText('2026 年 6 月月度报量', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: '2026 年 6 月月度报量', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: /^收款登记\s+1$/ }).click()
    await expect(page.getByRole('link', { name: '合和地产集团进度收款', exact: true })).toHaveAttribute('href', /\/finance\/receipt\/rr_mz0x1_0\?origin=demo&customerId=customer_demo_001/)
    await page.goto('/contract/con_demo_cg01?origin=demo&contractKind=material')
    await expect(page.getByRole('tab')).toHaveText(['详细信息', '采购明细 2', '补充协议 0', '材料管理', '发票登记 1', '付款信息 1', '支出结算 1', '项目扣罚 1'])
    await expect(page.getByRole('tab', { name: /变洽签/ })).toHaveCount(0)
  })
})
