import type { Locator, Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
} from './helpers/responsive'

const HEIGHTS: Record<(typeof RESPONSIVE_WIDTHS)[number], number> = {
  390: 844,
  768: 900,
  1024: 900,
  1440: 1000,
}

const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'
const CUSTOMER_INPUT = { id: 'customer_demo_001', name: '合和地产集团', origin: 'demo', missingId: 'not-exists', referenceTime: '2026-09-15T04:00:00.000Z' }
const RELATION_INPUT = {
  project: { name: '合和新城', path: '/project/proj_demo_001', query: { origin: 'demo' }, tab: 'projects' },
  contract: { name: '合和新城施工总承包合同', path: '/contract/con_demo_sg01', query: { origin: 'demo', contractKind: 'construction' }, tab: 'contracts' },
  receipt: { name: 'SK-2026-001', path: '/finance/receipt/rr_mz0x1_0', query: { origin: 'demo', customerId: 'customer_demo_001' }, tab: 'receipts' },
} as const

function customerPath() {
  return `/base/customer/${CUSTOMER_INPUT.id}`
}

function expectCustomerReturn(value: string, page: Page, tab: string) {
  expect(value).toMatch(/^\/(?!\/)/)
  const target = new URL(value, page.url())
  expect(target.origin).toBe(new URL(page.url()).origin)
  expect(target.pathname).toBe(customerPath())
  expect(target.hash).toBe('')
  expect(Object.fromEntries(target.searchParams)).toEqual({
    origin: CUSTOMER_INPUT.origin,
    ...(tab === 'projects' ? {} : { tab }),
    relationContext: expect.stringMatching(/^[\w-]{8,64}$/),
  })
  return target
}

async function expectRelationTarget(page: Page, link: Locator, input: (typeof RELATION_INPUT)[keyof typeof RELATION_INPUT]) {
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  expect(href).toMatch(/^\/(?!\/)/)
  const target = new URL(href!, page.url())
  expect(target.origin).toBe(new URL(page.url()).origin)
  expect(target.pathname).toBe(input.path)
  expect(target.hash).toBe('')
  expect(Object.fromEntries(target.searchParams)).toEqual({ ...input.query, returnTo: expect.any(String) })
  expectCustomerReturn(target.searchParams.get('returnTo')!, page, input.tab)
  return target
}

test.beforeEach(async ({ page }) => {
  const sessionId = `customer-detail-${randomUUID()}`
  await page.clock.install({ time: new Date(CUSTOMER_INPUT.referenceTime) })
  await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': sessionId })
  const response = await page.context().request.post('/api/testing/customers/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': sessionId },
    data: { scenario: 'ready' },
  })
  expect(response.ok(), await response.text()).toBe(true)
})

test.describe('Issue #194：客户详情', () => {
  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 展示真实客户关系且页面不横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHTS[width] })
      await page.goto(`${customerPath()}?origin=${CUSTOMER_INPUT.origin}`)

      const shell = page.locator('[data-ui="entity-detail-shell"]')
      await expect(shell.getByRole('heading', { name: CUSTOMER_INPUT.name }))
        .toBeVisible({ timeout: 30_000 })
      await expect(shell.getByText('测试客户只读')).toBeVisible()
      await expect(shell.getByRole('tab', { name: /名下项目/ })).toBeVisible()
      const project = shell.getByRole('link', { name: RELATION_INPUT.project.name, exact: true })
      const target = await expectRelationTarget(page, project, RELATION_INPUT.project)
      await project.focus()
      await project.press('Enter')
      await expect(page).toHaveURL(target.href)
      await expect(page.getByRole('heading', { name: RELATION_INPUT.project.name, exact: true })).toBeVisible()
      await page.reload()
      const back = page.getByRole('link', { name: '返回客户详情', exact: true })
      await expect(back).toHaveAttribute('href', target.searchParams.get('returnTo')!)
      await back.press('Enter')
      await expect(page).toHaveURL(new URL(target.searchParams.get('returnTo')!, target).href)
      await expect(shell.getByRole('heading', { name: CUSTOMER_INPUT.name })).toBeVisible()
      await expect(project).toBeFocused()
      await expectNoPageOverflow(page, `客户详情 @ ${width}px`)
    })
  }

  test('窄窗切换施工合同和收款后仍由表格局部横滚并保留下钻', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${customerPath()}?origin=${CUSTOMER_INPUT.origin}`)

    await page.getByRole('tab', { name: /施工合同/ }).click()
    const contract = page.getByRole('link', { name: RELATION_INPUT.contract.name, exact: true })
    const contractTarget = await expectRelationTarget(page, contract, RELATION_INPUT.contract)
    await expectLocalHorizontalScroll(
      page.locator('[data-ui="kit-table"] .vxe-table--body-inner-wrapper').first(),
      '客户施工合同表',
    )
    await contract.press('Enter')
    await expect(page).toHaveURL(contractTarget.href)
    await expect(page.getByRole('heading', { name: RELATION_INPUT.contract.name, exact: true })).toBeVisible()
    const contractBack = page.getByRole('link', { name: '返回客户详情', exact: true })
    await expect(contractBack).toHaveAttribute('href', contractTarget.searchParams.get('returnTo')!)
    await contractBack.click()
    await expect(contract).toBeFocused()

    await page.getByRole('tab', { name: /收款明细/ }).click()
    const receipt = page.getByRole('link', { name: RELATION_INPUT.receipt.name, exact: true })
    const receiptTarget = await expectRelationTarget(page, receipt, RELATION_INPUT.receipt)
    await expect(page.getByText('未记录', { exact: true })).toBeVisible()
    await expectLocalHorizontalScroll(
      page.locator('[data-ui="kit-table"] .vxe-table--body-inner-wrapper').first(),
      '客户收款表',
    )
    await receipt.press('Enter')
    await expect(page).toHaveURL(receiptTarget.href)
    await expect(page.getByRole('heading', { name: RELATION_INPUT.receipt.name, exact: true })).toBeVisible()
    const receiptBack = page.getByRole('link', { name: '返回来源页面', exact: true })
    await expect(receiptBack).toBeVisible()
    expectCustomerReturn((await receiptBack.getAttribute('href'))!, page, RELATION_INPUT.receipt.tab)
    await receiptBack.click()
    await expect(receipt).toBeFocused()
    await expect(page.getByRole('tab', { name: /收款明细/ })).toHaveAttribute('aria-selected', 'true')
    await expectNoPageOverflow(page, '客户详情窄窗')
  })

  test('业务页签支持深链、方向键切换并同步地址', async ({ page }) => {
    await page.goto(`${customerPath()}?origin=${CUSTOMER_INPUT.origin}&tab=contracts&from=list`)

    const contractTab = page.getByRole('tab', { name: /施工合同/ })
    const receiptTab = page.getByRole('tab', { name: /收款明细/ })
    await expect(contractTab).toHaveAttribute('aria-selected', 'true')
    await contractTab.focus()
    await page.keyboard.press('ArrowRight')

    await expect(receiptTab).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=receipts/)
    await expect(page).toHaveURL(/from=list/)
    await expectRelationTarget(page, page.getByRole('link', { name: RELATION_INPUT.receipt.name, exact: true }), RELATION_INPUT.receipt)
  })

  test('不存在的客户展示不存在状态并保留返回入口', async ({ page }) => {
    await page.goto(`/base/customer/${CUSTOMER_INPUT.missingId}`)

    await expect(page.getByRole('status', { name: '客户不存在或已删除' })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回客户列表' }))
      .toHaveAttribute('href', '/base/customer')
  })
})
