import type { Page } from '@playwright/test'
import type { SupplierListSourceRow } from '../app/lib/supplier/read-contract'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { buildSupplierDetailRead, buildSupplierListPage, parseSupplierDetailQuery, parseSupplierListQuery } from '../app/lib/supplier/read-page'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })

const suppliers: SupplierListSourceRow[] = Array.from({ length: 25 }, (_, index) => ({
  dataOrigin: 'real',
  id: `replica-supplier-${index + 1}`,
  name: `界面对照供应商${String(index + 1).padStart(2, '0')}`,
  aliases: [`简称${index + 1}`],
  externalRef: '',
  uniqueCode: `RH-${index + 1}`,
  taxNo: '',
  businessType: '工程服务',
  supplierCategory: index % 2 ? '劳务分包商' : '材料供应商',
  rating: '',
  legalRep: '',
  registeredCapital: null,
  registeredDate: null,
  address: index === 24 ? '深圳市南山区' : '广州市天河区',
  taxpayerType: index % 2 ? '小规模纳税人' : '一般纳税人',
  mainBusiness: '建筑施工',
  laborScope: index === 24 ? '精细油漆作业' : '砌筑作业',
  invoiceName: '',
  invoiceAddress: '',
  bank: '示例银行',
  bankAccount: '',
  phone: '',
  contact: `联系人${index + 1}`,
  contactPhone: '',
  contactTitle: '',
  credentialStatus: ['incomplete', 'reviewing', 'qualified', 'rejected'][index % 4]!,
  note: '',
  updatedAt: '2026-09-08T00:00:00.000Z',
}))
const supplierIdentities = new WeakMap<Page, SupplierListSourceRow[]>()

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `supplier-replica-${randomUUID()}` })
  const session = await (await page.request.get('/api/read/business-session')).json()
  const rows: SupplierListSourceRow[] = []
  for (const input of suppliers) {
    const created = await page.request.post('/api/commands/suppliers', { data: { ...session, commandId: randomUUID(), requiredCapability: 'supplier:write', baseVersion: null, action: 'draft', draft: { name: input.name, supplierCategory: input.supplierCategory, contact: input.contact }, attachments: {} } })
    expect(created.ok(), await created.text()).toBe(true)
    rows.push({ ...input, id: (await created.json()).id })
  }
  supplierIdentities.set(page, rows)
  await page.route('**/api/read/suppliers?*', async (route) => {
    const query = parseSupplierListQuery(Object.fromEntries(new URL(route.request().url()).searchParams))
    await route.fulfill({ json: buildSupplierListPage({
      suppliers: rows,
      query,
      projectSuppliers: [],
      contracts: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      settlements: [],
      asOf: '2026-09-08T00:00:00.000Z',
      sourceVersion: 'replica-synthetic',
      capabilities: ['supplier:list:read', 'supplier:read', 'supplier:write'],
    }) })
  })
})

for (const width of RESPONSIVE_WIDTHS) {
  test(`${width}px：完整列、紧凑标签、表格内滚动及可访问工具`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/base/supplier?sort=name-asc')
    const list = page.locator('.supplier-reference-list')
    await expect(list.getByRole('heading', { name: '全部分供方' })).toBeVisible()
    await expect(list.getByRole('link', { name: '界面对照供应商01', exact: true })).toBeVisible()
    await expect(list.getByRole('button', { name: '筛选分供方名称', exact: true })).toBeVisible()
    await expect(list.getByRole('button', { name: '排序', exact: true })).toBeVisible()
    await expect(list.getByRole('button', { name: '列设置', exact: true })).toBeVisible()
    await expect(list.getByRole('button', { name: '新增分供方' })).toBeVisible()
    await expect(list.getByRole('combobox', { name: '每页条数' })).toHaveValue('20')
    for (const tone of ['warn', 'brand', 'ok', 'danger'])
      await expect(list.locator(`[data-ui="status-tag"][data-tone="${tone}"]`).first()).toHaveCSS('border-radius', '2px')
    const scroller = list.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')
    await expect.poll(() => scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    await scroller.evaluate(el => el.scrollLeft = el.scrollWidth)
    await expect(list.getByRole('button', { name: '筛选确认实付', exact: true })).toBeVisible()
    await expectNoPageOverflow(page, `${width}px 完整分供方宽表`)
    await list.getByRole('button', { name: '列设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '列设置', exact: true })
    await expect(settings.getByRole('checkbox', { name: '劳务承包范围', exact: true })).toBeChecked()
    await settings.getByRole('checkbox', { name: '劳务承包范围', exact: true }).uncheck()
    await page.keyboard.press('Escape')
    await expect(list.getByRole('button', { name: '列设置', exact: true })).toBeFocused()
    await expect(list.getByRole('button', { name: '筛选劳务承包范围', exact: true })).toHaveCount(0)
    await list.getByRole('button', { name: '列设置', exact: true }).click()
    await settings.getByRole('button', { name: '恢复默认' }).click()
    await page.keyboard.press('Escape')
    await scroller.evaluate(el => el.scrollLeft = 0)
    await expectNoPageOverflow(page, `${width}px 设置浮层`)
    expect(errors).toEqual([])
  })
}

test('搜索与列头条件都筛全量记录，分页、工具筛选与清空同步', async ({ page }) => {
  await page.goto('/base/supplier?sort=name-asc')
  const list = page.locator('.supplier-reference-list')
  const search = list.getByRole('searchbox')
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
  await list.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(list.getByRole('link', { name: '界面对照供应商25', exact: true })).toBeVisible()
  await search.fill('精细油漆')
  await expect(list.getByText('共 1 条', { exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: '第 1 页' })).toHaveAttribute('aria-current', 'page')
  await search.fill('')
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
  await list.getByRole('button', { name: '筛选注册地址', exact: true }).click()
  await page.getByRole('textbox', { name: '注册地址包含' }).fill('深圳')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(list.getByRole('link', { name: '界面对照供应商25', exact: true })).toBeVisible()
  await expect(list.getByText('共 1 条', { exact: true })).toBeVisible()
  const target = await list.getByRole('link', { name: '界面对照供应商25', exact: true }).getAttribute('href')
  const returnTo = new URL(new URL(target!, 'https://crm.test').searchParams.get('returnTo')!, 'https://crm.test')
  expect(JSON.parse(returnTo.searchParams.get('columnFilters')!).contains.address).toBe('深圳')
  await list.getByRole('button', { name: '筛选', exact: true }).click()
  await page.getByRole('button', { name: '清除全部筛选' }).click()
  await page.keyboard.press('Escape')
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
})

test('返回定位仅执行一次，继续搜索不抢焦点且数值升序正确显示', async ({ page }) => {
  const id = supplierIdentities.get(page)![0]!.id
  await page.goto(`/base/supplier?sort=paymentAmount-asc#supplier-row-${encodeURIComponent(encodeURIComponent(`real:${id}`))}`)
  const list = page.locator('.supplier-reference-list')
  await expect(list.getByRole('link', { name: '界面对照供应商01', exact: true })).toBeFocused()
  const focusedName = list.getByRole('link', { name: '界面对照供应商01', exact: true })
  await expect(focusedName).toHaveCSS('outline-style', 'none')
  await expect(focusedName).toHaveCSS('text-decoration-line', 'underline')
  const search = list.getByRole('searchbox')
  const response = page.waitForResponse(res => res.url().includes('/api/read/suppliers?') && res.url().includes('search='))
  await search.fill('界面对照')
  await response
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
  await expect(search).toBeFocused()
  await list.getByRole('button', { name: '排序', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '排序方式' })).toHaveValue('paymentAmount-asc')
})

test('列表默认控件使用细实线，不出现浏览器原生凹凸边框', async ({ page }) => {
  await page.goto('/base/supplier?sort=name-asc')
  const list = page.locator('.supplier-reference-list')
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
  await expect(list.getByRole('searchbox')).toHaveCSS('border-top-style', 'solid')
  await expect(list.getByRole('searchbox')).toHaveCSS('border-top-width', '1px')
  await expect(list.getByRole('button', { name: '界面对照供应商01操作', exact: true })).toHaveCSS('border-top-style', 'solid')
})

test('筛选等待响应时保留现有表格，不闪出整块加载遮罩', async ({ page }) => {
  await page.goto('/base/supplier?sort=name-asc')
  const list = page.locator('.supplier-reference-list')
  const search = list.getByRole('searchbox')
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
  let finishRequest!: () => void
  const pending = new Promise<void>(resolve => finishRequest = resolve)
  let requestStarted!: () => void
  const started = new Promise<void>(resolve => requestStarted = resolve)
  let requests = 0
  await page.route('**/api/read/suppliers?*', async (route) => {
    requests += 1
    requestStarted()
    await pending
    await route.fallback()
  })
  const scroller = list.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')
  await expect.poll(() => scroller.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(600)
  await page.clock.install()
  await scroller.evaluate(el => el.scrollLeft = 600)
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBe(600)
  await search.fill('精细油漆')
  await started
  try {
    await expect(list.getByRole('link', { name: '界面对照供应商01', exact: true })).toBeVisible()
    await expect(list.locator('[data-ui="kit-table-loading"]')).toBeHidden({ timeout: 300 })
    await expect(list.locator('[data-ui="supplier-list-table"]')).toHaveAttribute('aria-busy', 'true')
    await expect(search).toBeFocused()
    expect(await scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(500)
  }
  finally {
    finishRequest()
  }
  await expect(list.getByText('共 1 条', { exact: true })).toBeVisible()
  await expect(list.getByRole('link', { name: '界面对照供应商25', exact: true })).toBeVisible()
  await expect(search).toBeFocused()
  await expect(list.locator('[data-ui="supplier-list-table"]')).toHaveAttribute('aria-busy', 'false')
  expect(await scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(500)
  const beforeClear = requests
  await list.getByRole('button', { name: '筛选', exact: true }).click()
  await page.getByRole('button', { name: '清除全部筛选', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(list.getByText('共 25 条', { exact: true })).toBeVisible()
  // 覆盖180ms防抖窗口，清空操作不能又触发第二次相同请求。
  await page.clock.runFor(360)
  expect(requests - beforeClear).toBe(1)
})

test('四态从筛选列表进入同来源详情，刷新及返回后文字、色调和定位一致', async ({ page }) => {
  const rows = supplierIdentities.get(page)!
  await page.route(/\/api\/read\/suppliers\/[^/?]+\?/, async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({ json: buildSupplierDetailRead({
      suppliers: rows,
      projects: [],
      projectSuppliers: [],
      contracts: [],
      settlements: [],
      invoices: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      query: parseSupplierDetailQuery(url.pathname.split('/').at(-1)!, Object.fromEntries(url.searchParams)),
      asOf: '2026-09-08T00:00:00.000Z',
      sourceVersion: 'replica-synthetic',
      capabilities: ['supplier:list:read', 'supplier:read'],
    }) })
  })
  const states = [
    { label: '资料缺失', tone: 'warn' },
    { label: '齐全待核验', tone: 'brand' },
    { label: '合格', tone: 'ok' },
    { label: '退回', tone: 'danger' },
  ]
  for (const [index, state] of states.entries()) {
    const { name, id } = rows[index]!
    await page.goto(`/base/supplier?sort=name-asc&search=${encodeURIComponent(name)}`)
    const list = page.locator('.supplier-reference-list')
    const status = list.locator('[data-ui="status-tag"]').first()
    await expect(status).toHaveText(state.label)
    await expect(status).toHaveAttribute('data-tone', state.tone)
    await list.getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(url => url.pathname === `/base/supplier/${id}` && url.searchParams.get('origin') === 'real')
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const detailStatus = page.locator('[data-ui="status-tag"]').first()
    await expect(detailStatus).toHaveText(state.label)
    await expect(detailStatus).toHaveAttribute('data-tone', state.tone)
    await page.reload()
    await expect(detailStatus).toHaveText(state.label)
    await page.getByRole('link', { name: '返回分供方列表', exact: true }).click()
    await expect(list.getByRole('searchbox')).toHaveValue(name)
    await expect(list.getByRole('link', { name, exact: true })).toBeFocused()
    await expect(status).toHaveAttribute('data-tone', state.tone)
  }
})
