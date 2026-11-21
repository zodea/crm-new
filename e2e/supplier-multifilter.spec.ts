import type { SupplierListSourceRow } from '../app/lib/supplier/read-contract'
import { expect, test } from '@playwright/test'
import { parseSupplierListQuery } from '../app/lib/supplier/read-page'
import { buildSupplierListPage } from '../tests/helpers/supplier-read-meta'
import { expectNoPageOverflow } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })

const suppliers: SupplierListSourceRow[] = Array.from({ length: 30 }, (_, index) => ({
  dataOrigin: 'real',
  id: `multi-${index}`,
  name: `多选供应商${String(index).padStart(2, '0')}`,
  aliases: [],
  externalRef: '',
  uniqueCode: '',
  taxNo: '',
  supplierCategory: ['材料供应商', '劳务分包商', '设备供应商'][index % 3]!,
  credentialStatus: index < 20 ? 'qualified' : 'reviewing',
  taxpayerType: index % 2 ? '小规模纳税人' : '一般纳税人',
  businessType: '施工',
  rating: '',
  legalRep: '',
  registeredCapital: null,
  registeredDate: null,
  address: index < 15 ? '广州' : '深圳',
  mainBusiness: '',
  laborScope: '',
  invoiceName: '',
  invoiceAddress: '',
  bank: '',
  bankAccount: '',
  phone: '',
  contact: '',
  contactPhone: '',
  contactTitle: '',
  note: '',
  updatedAt: '2026-09-08T00:00:00.000Z',
}))

test.beforeEach(async ({ page }) => {
  await page.route('**/api/read/suppliers?*', async (route) => {
    const query = parseSupplierListQuery(Object.fromEntries(new URL(route.request().url()).searchParams))
    await route.fulfill({ json: buildSupplierListPage({ suppliers, query, projectSuppliers: [], contracts: [], paymentApplications: [], paymentRecords: [], paymentAllocations: [], settlements: [], asOf: '2026-09-08T00:00:00.000Z', sourceVersion: 'multi-enum-fixture', capabilities: ['supplier:list:read', 'supplier:write'] }) })
  })
})

for (const width of [390, 1440]) {
  test(`${width}px 固定枚举复选与表头联动，返回链接保留组合且清空恢复全量`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/base/supplier?sort=name-asc')
    const list = page.locator('.supplier-reference-list')
    await expect(list.getByText('共 30 条', { exact: true })).toBeVisible()
    await list.getByRole('button', { name: '筛选', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '筛选', exact: true })
    const categories = dialog.getByRole('group', { name: '分供方类别', exact: true })
    await categories.getByRole('checkbox', { name: /^材料供应商/ }).check()
    await expect(list.getByText('共 10 条', { exact: true })).toBeVisible()
    await categories.getByRole('checkbox', { name: /^劳务分包商/ }).check()
    await expect(list.getByText('共 20 条', { exact: true })).toBeVisible()
    await dialog.getByRole('group', { name: '资料状态', exact: true }).getByRole('checkbox', { name: /^合格/ }).check()
    await expect(list.getByText('共 14 条', { exact: true })).toBeVisible()
    await dialog.getByRole('group', { name: '纳税人类型', exact: true }).getByRole('checkbox', { name: /^一般纳税人/ }).check()
    await expect(list.getByText('共 7 条', { exact: true })).toBeVisible()
    await expectNoPageOverflow(page, '枚举工具筛选浮层')
    await page.keyboard.press('Escape')
    await list.getByRole('button', { name: '筛选分供方类别', exact: true }).click()
    const header = page.getByRole('dialog', { name: '筛选分供方类别', exact: true })
    await expect(header.getByRole('checkbox', { name: /^材料供应商/ })).toBeChecked()
    await expect(header.getByRole('checkbox', { name: /^劳务分包商/ })).toBeChecked()
    await expect(header.getByRole('textbox')).toHaveCount(0)
    await header.getByRole('checkbox', { name: /^设备供应商/ }).check()
    await header.getByRole('button', { name: '应用', exact: true }).click()
    await expect(list.getByText('共 10 条', { exact: true })).toBeVisible()
    const link = list.getByRole('link', { name: '多选供应商00', exact: true })
    const href = await link.getAttribute('href')
    const returnTo = new URL(href!, 'https://crm.test').searchParams.get('returnTo')!
    const returned = new URL(returnTo, 'https://crm.test')
    expect(JSON.parse(returned.searchParams.get('category')!)).toHaveLength(3)
    expect(returned.searchParams.get('credentialStatus')).toBe('qualified')
    expect(JSON.parse(returned.searchParams.get('columnFilters')!).taxpayerType).toEqual(['一般纳税人'])
    await page.goto(returnTo)
    await expect(list.getByText('共 10 条', { exact: true })).toBeVisible()
    await list.getByRole('button', { name: '筛选', exact: true }).click()
    await expect(dialog.getByRole('group', { name: '分供方类别', exact: true }).getByRole('checkbox', { name: /^设备供应商/ })).toBeChecked()
    await dialog.getByRole('button', { name: '清除全部筛选' }).click()
    await expect(list.getByText('共 30 条', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await list.getByRole('button', { name: '筛选分供方名称', exact: true }).first().click()
    await page.getByRole('textbox', { name: '分供方名称包含' }).fill('不存在')
    await page.getByRole('button', { name: '应用', exact: true }).click()
    await expect(list.getByText('没有符合条件的分供方', { exact: true }).filter({ visible: true })).toBeVisible()
    await list.getByRole('button', { name: '清除筛选', exact: true }).filter({ visible: true }).click()
    await expect(list.getByText('共 30 条', { exact: true })).toBeVisible()
  })
}
