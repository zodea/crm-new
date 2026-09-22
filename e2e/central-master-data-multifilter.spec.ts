import type { CrewSourceRow, WorkerSourceRow } from '../app/lib/crew-worker/read-contract'
import type { CustomerListSourceRow } from '../app/lib/customer/read-contract'
import { expect, test } from '@playwright/test'
import { buildCrewListPage, buildWorkerListPage, parseCrewListQuery, parseWorkerListQuery } from '../app/lib/crew-worker/read-page'
import { buildCustomerListPage, parseCustomerListQuery } from '../app/lib/customer/read-page'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })
const asOf = '2026-09-08T00:00:00.000Z'
const customers: CustomerListSourceRow[] = Array.from({ length: 6 }, (_, index) => ({
  dataOrigin: 'real',
  id: `multi-customer-${index}`,
  name: `多选客户${index}`,
  aliases: [],
  taxNo: '',
  legalRep: '',
  registeredAddress: '',
  invoiceName: '',
  bank: '',
  bankAccount: '',
  contact: '',
  contactPhone: '',
  status: ['active', 'inactive', 'draft'][index % 3]!,
  note: '',
  updatedAt: asOf,
}))
const crews: CrewSourceRow[] = Array.from({ length: 6 }, (_, index) => ({
  dataOrigin: 'real',
  id: `multi-crew-${index}`,
  name: `多选班组${index}`,
  trade: ['木工', '泥工', '电工'][index % 3]!,
  tradeCapabilities: [],
  itemCapabilities: [],
  contactName: '',
  contactPhone: '',
  defaultPayRatio: 1,
  rentSubsidyEnabled: false,
  rentSubsidyPrice: null,
  mgmtFeeEnabled: false,
  mgmtFeePrice: null,
  assignmentLevel: 'crew',
  note: '',
  status: 'active',
  updatedAt: asOf,
}))
const workers: WorkerSourceRow[] = crews.map((crew, index) => ({
  dataOrigin: 'real',
  id: `multi-worker-${index}`,
  name: `多选工人${index}`,
  crewId: crew.id,
  currentProjectId: null,
  trade: crew.trade,
  phone: '',
  idCard: '',
  projectStatus: '在场',
  status: 'active',
  entryDate: null,
  exitDate: null,
  safetyEducation: false,
  updatedAt: asOf,
}))

test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/read\/(customers|crews|workers)\?/, async (route) => {
    const url = new URL(route.request().url())
    const input = Object.fromEntries(url.searchParams)
    const common = { asOf, sourceVersion: 'multi-fixture', capabilities: [], crews, workers, projects: [], assignments: [], wages: [] }
    const result = url.pathname.endsWith('/customers')
      ? buildCustomerListPage({ ...common, rows: customers, query: parseCustomerListQuery(input) })
      : url.pathname.endsWith('/crews') ? buildCrewListPage({ ...common, query: parseCrewListQuery(input) }) : buildWorkerListPage({ ...common, query: parseWorkerListQuery(input) })
    await route.fulfill({ json: result })
  })
})

for (const kind of ['customer', 'crew', 'worker'] as const) {
  test(`${kind} 固定筛选复选、候选保留和返回恢复`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(`/base/${kind}`)
    const table = page.locator(`[data-ui="${kind === 'customer' ? 'customer-list' : `${kind}-central-list`}-table"]`)
    await expect(table.getByText('共 6 条', { exact: true })).toBeVisible()
    const label = kind === 'customer' ? '档案状态' : '工种'
    const choices = kind === 'customer' ? ['有效', '停用'] : ['木工', '泥工']
    await page.getByRole('button', { name: `${label}，已选 0 项`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: new RegExp(`^${label}`) })
    for (const name of choices)
      await dialog.getByRole('checkbox', { name: new RegExp(`^${name}`) }).check()
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(table.getByText('共 4 条', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `${label}，已选 2 项`, exact: true }).click()
    await expect(dialog.getByRole('checkbox', { name: kind === 'customer' ? /^草稿/ : /^电工/ })).toBeVisible()
    await expectNoPageOverflow(page, `${kind}复选浮层`)
    await page.keyboard.press('Escape')
    const link = table.getByRole('link', { name: kind === 'customer' ? '多选客户0' : kind === 'crew' ? '多选班组0' : '多选工人0', exact: true }).filter({ visible: true })
    const href = await link.getAttribute('href')
    const returnTo = new URL(href!, 'https://crm.test').searchParams.get('returnTo')!
    expect(JSON.parse(new URL(returnTo, 'https://crm.test').searchParams.get(kind === 'customer' ? 'status' : 'trade')!)).toHaveLength(2)
    await page.goto(returnTo)
    await expect(table.getByText('共 4 条', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `${label}，已选 2 项`, exact: true }).click()
    await dialog.getByRole('button', { name: '清除', exact: true }).click()
    await expect(table.getByText('共 6 条', { exact: true })).toBeVisible()
  })
}
