import type { CrewSourceRow, WorkerSourceRow } from '../app/lib/crew-worker/read-contract'
import type { CustomerListSourceRow } from '../app/lib/customer/read-contract'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { buildCrewListPage, buildWorkerListPage, parseCrewListQuery, parseWorkerListQuery } from '../app/lib/crew-worker/read-page'
import { buildCustomerListPage, parseCustomerListQuery } from '../app/lib/customer/read-page'
import { createReadMeta, readQueryScope, withOriginReadMeta } from '../server/utils/read-meta'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })
const asOf = '2026-09-08T00:00:00.000Z'
const FIXTURE_INPUT = { rowsPerCategory: 2, customerStatuses: ['active', 'inactive', 'draft'], trades: ['木工', '泥工', '电工'] }
const customers: CustomerListSourceRow[] = Array.from({ length: FIXTURE_INPUT.rowsPerCategory * FIXTURE_INPUT.customerStatuses.length }, (_, index) => ({
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
  status: FIXTURE_INPUT.customerStatuses[index % FIXTURE_INPUT.customerStatuses.length]!,
  note: '',
  updatedAt: asOf,
}))
const crews: CrewSourceRow[] = Array.from({ length: FIXTURE_INPUT.rowsPerCategory * FIXTURE_INPUT.trades.length }, (_, index) => ({
  dataOrigin: 'real',
  id: `multi-crew-${index}`,
  name: `多选班组${index}`,
  trade: FIXTURE_INPUT.trades[index % FIXTURE_INPUT.trades.length]!,
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
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `master-multifilter-${randomUUID()}` })
  await page.clock.install({ time: new Date(asOf) })
  const sessionResponse = await page.request.get('/api/read/business-session')
  expect(sessionResponse.ok(), await sessionResponse.text()).toBe(true)
  const session = await sessionResponse.json()
  await page.route(/\/api\/read\/(customers|crews|workers)\?/, async (route) => {
    const url = new URL(route.request().url())
    const input = Object.fromEntries(url.searchParams)
    const customer = url.pathname.endsWith('/customers')
    const crew = url.pathname.endsWith('/crews')
    const query = customer ? parseCustomerListQuery(input) : crew ? parseCrewListQuery(input) : parseWorkerListQuery(input)
    const common = { asOf, sourceVersion: 'multi-fixture', capabilities: session.capabilities, crews, workers, projects: [], assignments: [], wages: [] }
    const result = customer
      ? buildCustomerListPage({ ...common, rows: customers, query: parseCustomerListQuery(input) })
      : crew ? buildCrewListPage({ ...common, query: parseCrewListQuery(input) }) : buildWorkerListPage({ ...common, query: parseWorkerListQuery(input) })
    const schemaVersion = customer ? 'customer-read-v2' : 'crew-worker-read-v2'
    const sources = (origin: 'real' | 'demo') => (customer ? ['customers'] : ['crews', 'workers', 'projects', 'assignments', 'wages']).map(key => ({ key, state: origin === 'real' ? 'readable' as const : 'not-requested' as const, sourceVersion: origin === 'real' ? 'multi-fixture' : null, asOf: origin === 'real' ? asOf : null }))
    const meta = (origin: 'real' | 'demo') => createReadMeta({ session, schemaVersion, operation: `${customer ? 'customer' : crew ? 'crew' : 'worker'}:list`, dataOrigin: origin, asOf, coverage: origin === 'real' ? 'complete' : 'unknown', scope: readQueryScope(query), sources: sources(origin) })
    await route.fulfill({ json: withOriginReadMeta(result, { real: meta('real'), demo: meta('demo') }) })
  })
})

for (const input of [
  { kind: 'customer', label: '档案状态', choices: ['有效', '停用'], selectedValues: ['active', 'inactive'], remainingChoice: '草稿', names: customers.map(row => row.name), selectedNames: ['多选客户0', '多选客户1', '多选客户3', '多选客户4'], queryKey: 'status' },
  { kind: 'crew', label: '工种', choices: ['木工', '泥工'], selectedValues: ['木工', '泥工'], remainingChoice: '电工', names: crews.map(row => row.name), selectedNames: ['多选班组0', '多选班组1', '多选班组3', '多选班组4'], queryKey: 'trade' },
  { kind: 'worker', label: '工种', choices: ['木工', '泥工'], selectedValues: ['木工', '泥工'], remainingChoice: '电工', names: workers.map(row => row.name), selectedNames: ['多选工人0', '多选工人1', '多选工人3', '多选工人4'], queryKey: 'trade' },
] as const) {
  const { kind, label, choices } = input
  const selectedNames: readonly string[] = input.selectedNames
  test(`${kind} 固定筛选复选、候选保留和返回恢复`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto(`/base/${kind}`)
    const table = page.locator(`[data-ui="${kind === 'customer' ? 'customer-list' : `${kind}-central-list`}-table"]`)
    await expect(table.getByText(`共 ${input.names.length} 条`, { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: `${label}，已选 0 项`, exact: true }).click()
    const dialog = page.getByRole('dialog', { name: new RegExp(`^${label}`) })
    for (const name of choices)
      await dialog.getByRole('checkbox', { name: new RegExp(`^${name}`) }).check()
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(table.getByText(`共 ${input.selectedNames.length} 条`, { exact: true })).toBeVisible()
    for (const name of input.selectedNames)
      await expect(table.getByRole('link', { name, exact: true }).filter({ visible: true })).toBeVisible()
    for (const name of input.names.filter(name => !selectedNames.includes(name)))
      await expect(table.getByRole('link', { name, exact: true }).filter({ visible: true })).toHaveCount(0)
    await page.getByRole('button', { name: `${label}，已选 ${choices.length} 项`, exact: true }).click()
    await expect(dialog.getByRole('checkbox', { name: new RegExp(`^${input.remainingChoice}`) })).toBeVisible()
    await expectNoPageOverflow(page, `${kind}复选浮层`)
    await page.keyboard.press('Escape')
    const link = table.getByRole('link', { name: input.selectedNames[0], exact: true }).filter({ visible: true })
    const href = await link.getAttribute('href')
    const returnTo = new URL(href!, 'https://crm.test').searchParams.get('returnTo')!
    expect(JSON.parse(new URL(returnTo, 'https://crm.test').searchParams.get(input.queryKey)!)).toEqual(input.selectedValues)
    await page.goto(returnTo)
    await expect(table.getByText(`共 ${input.selectedNames.length} 条`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `${label}，已选 ${choices.length} 项`, exact: true }).click()
    await dialog.getByRole('button', { name: '清除', exact: true }).click()
    await expect(table.getByText(`共 ${input.names.length} 条`, { exact: true })).toBeVisible()
  })
}
