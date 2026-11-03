import type { Locator, Page } from '@playwright/test'
import type { ConstructionContractDetailSource } from '../app/lib/construction-contract/read-contract'
import type { CustomerContractSourceRow, CustomerListSourceRow, CustomerProjectSourceRow, CustomerReceiptSourceRow } from '../app/lib/customer/read-contract'
import type { ProjectListSourceRow } from '../app/lib/project/read-contract'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { buildConstructionContractDetail, parseConstructionContractDetailQuery } from '../app/lib/construction-contract/read-page'
import { buildCustomerDetailRead, parseCustomerDetailQuery } from '../app/lib/customer/read-page'
import { buildProjectDetailRead, parseProjectDetailQuery } from '../app/lib/project/read-page'
import { emptyReceiptDraft } from '../app/lib/receipt/contract'
import { createReadMeta, readQueryScope, withReadMeta } from '../server/utils/read-meta'
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
const CUSTOMER_INPUT = { id: 'customer-synthetic-detail', name: '合成详情客户', origin: 'demo', missingId: 'not-exists', referenceTime: '2026-09-15T04:00:00.000Z' }
const RELATION_INPUT = {
  project: { name: '合成详情关联项目', path: '/project/project-synthetic-customer', query: { origin: 'demo' }, tab: 'projects' },
  contract: { name: '合成详情施工合同', path: '/contract/contract-synthetic-customer', query: { origin: 'demo', contractKind: 'construction' }, tab: 'contracts' },
  receipt: { name: 'SK-SYNTHETIC-01', path: '/finance/receipt/receipt-synthetic-customer', query: { origin: 'demo', customerId: CUSTOMER_INPUT.id }, tab: 'receipts' },
} as const

const asOf = CUSTOMER_INPUT.referenceTime
const customer: CustomerListSourceRow = { dataOrigin: 'demo', id: CUSTOMER_INPUT.id, name: CUSTOMER_INPUT.name, aliases: [], taxNo: '', legalRep: '', registeredAddress: '', invoiceName: '', bank: '', bankAccount: '', contact: '合成联系人', contactPhone: '', status: '正常', note: '', updatedAt: asOf }
const project: CustomerProjectSourceRow = { dataOrigin: 'demo', id: 'project-synthetic-customer', name: RELATION_INPUT.project.name, code: 'PROJECT-SYNTHETIC', customerId: customer.id, secondaryCustomerId: null, permission: 'allowed', status: '施工中', startDate: null, plannedEnd: null, manager: '合成经办人' }
const contract: CustomerContractSourceRow = { dataOrigin: 'demo', id: 'contract-synthetic-customer', no: 'SG-SYNTHETIC', name: RELATION_INPUT.contract.name, projectId: project.id, customerId: customer.id, amount: 1000, supplementAmount: 0, receiptAmount: 200, signDate: null, status: '履约中' }
const receipt: CustomerReceiptSourceRow = { dataOrigin: 'demo', id: 'receipt-synthetic-customer', no: RELATION_INPUT.receipt.name, customerId: customer.id, projectId: project.id, contractId: null, payerAccount: '', amount: 200, paymentMethod: '', receiptDate: null, status: '已确认' }

const projectSource: ProjectListSourceRow = {
  dataOrigin: 'demo',
  id: project.id,
  name: project.name,
  code: project.code,
  status: project.status,
  contractAmount: null,
  operationType: '',
  startDate: null,
  plannedEnd: null,
  actualEnd: null,
  plannedDuration: null,
  manager: project.manager,
  execManager: '',
  builder: '',
  customerId: customer.id,
  customerName: customer.name,
  customerPermission: 'allowed',
  secondaryCustomerId: null,
  secondaryCustomerName: null,
  secondaryCustomerPermission: 'allowed',
  contractName: '',
  contractor: '',
  region: '',
  riskLevel: '',
  address: '',
  income: null,
  budget: null,
  updatedAt: asOf,
}
const contractSource: ConstructionContractDetailSource = {
  dataOrigin: 'demo',
  id: contract.id,
  no: contract.no,
  name: contract.name,
  kind: '施工',
  projectId: project.id,
  projectName: project.name,
  projectPermission: 'allowed',
  customerId: customer.id,
  customerName: customer.name,
  customerPermission: 'allowed',
  amount: 1000,
  settledAmount: null,
  invoicedAmount: null,
  receivedAmount: 200,
  actualCompletionDate: null,
  content: '',
  invoiceType: '',
  contactName: '',
  contactPhone: '',
  taxRate: null,
  signDate: null,
  mainTerms: '',
  paymentTerms: '',
  warrantyTerms: '',
  retentionRatio: null,
  retentionAmount: null,
  retentionDays: null,
  invoiceName: '',
  invoiceTaxNo: '',
  invoiceAddressPhone: '',
  invoiceBank: '',
  invoiceBankAccount: '',
  status: '履约中',
  note: '',
  createdAt: asOf,
  updatedAt: asOf,
}

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
  const sessionResponse = await page.request.get('/api/read/business-session')
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const session = await sessionResponse.json()
  const sources = ['customers', 'projects', 'construction-contracts', 'receipts'].map(key => ({ key, state: 'readable' as const, sourceVersion: 'synthetic-customer-detail-v1', asOf }))
  const meta = (schemaVersion: string, operation: string, query: object) => createReadMeta({ session, schemaVersion, operation, dataOrigin: 'demo', asOf, coverage: 'complete', scope: { query: readQueryScope(query) }, sources })
  await page.route(/\/api\/read\/customers\/customer-synthetic-detail(?:\?|$)/, async (route) => {
    const query = parseCustomerDetailQuery(customer.id, Object.fromEntries(new URL(route.request().url()).searchParams))
    const detail = buildCustomerDetailRead({ customers: [customer], projects: [project], contracts: [contract], receipts: [receipt], query, asOf, sourceVersion: 'synthetic-customer-detail-v1', capabilities: session.capabilities })
    await route.fulfill({ json: withReadMeta(detail, meta('customer-read-v2', 'customer:detail', query)) })
  })
  await page.route(/\/api\/read\/projects\/project-synthetic-customer(?:\?|$)/, async (route) => {
    const query = parseProjectDetailQuery(project.id, Object.fromEntries(new URL(route.request().url()).searchParams))
    const detail = buildProjectDetailRead({ rows: [projectSource], query, asOf, sourceVersion: 'synthetic-customer-detail-v1', capabilities: session.capabilities })
    await route.fulfill({ json: withReadMeta(detail, meta('project-read-v2', 'project:detail', query)) })
  })
  await page.route(/\/api\/read\/construction-contracts\/contract-synthetic-customer(?:\?|$)/, async (route) => {
    const query = parseConstructionContractDetailQuery(contract.id, Object.fromEntries(new URL(route.request().url()).searchParams))
    const facts = { supplements: [], changes: [], monthlyStatements: [], finalSettlements: [], penalties: [], invoiceApplications: [], invoiceRegistrations: [], receipts: [], acceptances: [], warranties: [], files: [] }
    const detail = buildConstructionContractDetail({ contracts: [contractSource], facts, query, asOf, sourceVersion: 'synthetic-customer-detail-v1', capabilities: session.capabilities })
    await route.fulfill({ json: withReadMeta(detail, meta('construction-contract-read-v2', 'construction-contract:detail', query)) })
  })
  await page.route(/\/api\/read\/receipts\/receipt-synthetic-customer\/record(?:\?|$)/, async (route) => {
    const query = Object.fromEntries(new URL(route.request().url()).searchParams)
    const record = { id: receipt.id, dataOrigin: 'demo' as const, draft: { ...emptyReceiptDraft(), no: receipt.no, projectId: project.id, customerId: customer.id, amount: '200.00', status: 'submitted' }, version: '1', attachments: [], createdAt: asOf, updatedAt: asOf, createdBy: '合成经办人', updatedBy: '合成经办人' }
    const projectRef = { state: 'resolved' as const, entity: 'project' as const, id: project.id, label: project.name, no: project.code }
    const customerRef = { state: 'resolved' as const, entity: 'customer' as const, id: customer.id, label: customer.name, no: null }
    const contractRef = { state: 'missing' as const, entity: 'contract' as const, id: null, label: null, reason: 'not-recorded' as const }
    const amounts = { contractOriginal: null, contractChange: null, contract: null, cumulativeReceipt: null, cumulativeReceiptExcludingCurrent: null, receiptRatio: null, invoicedUnreceived: null }
    await route.fulfill({ json: withReadMeta({ record, category: null, receiptType: null, project: projectRef, customer: customerRef, contract: contractRef, amounts, asOf, sourceVersion: 'synthetic-customer-detail-v1', capabilities: session.capabilities }, meta('receipt-read-v2', 'receipt:detail', query)) })
  })
})

test.describe('Issue #194：客户详情', () => {
  test('展示合成客户关系，键盘下钻往返恢复焦点，各宽度页面不横向溢出', async ({ page }) => {
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
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHTS[width] })
      await expect(shell.getByRole('heading', { name: CUSTOMER_INPUT.name })).toBeVisible()
      await expectNoPageOverflow(page, `客户详情 @ ${width}px`)
    }
  })

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
