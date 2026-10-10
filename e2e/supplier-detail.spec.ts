import type { Page } from '@playwright/test'
import type { SupplierCredentialSnapshot } from '../app/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { cooperationPdfFixture } from '../tests/project-supplier/pdf-fixture'
import { expectLocalHorizontalScroll, expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const supplierInput = {
  name: 'E2E正式分供方详情',
  supplierCategory: '材料供应商',
  contact: '合成联系人',
  contactPhone: '13800003456',
  taxNo: '91440104MA5JKL3456',
  bankAccount: '6228 4800 5566 7788',
}
const pdf = Buffer.from(cooperationPdfFixture('Supplier detail original'))
const credentialInputs = [
  { category: '营业执照', fileName: 'E2E营业执照.pdf' },
  { category: '法人身份证', fileName: 'E2E法人身份证.pdf' },
  { category: '银行账户资料', fileName: 'E2E银行账户资料.pdf' },
]

test.beforeEach(async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `supplier-detail-${randomUUID()}` })
})

async function createSupplier(page: Page) {
  const session = await (await page.request.get('/api/read/business-session')).json()
  const response = await page.request.post('/api/commands/suppliers', {
    data: { ...session, requiredCapability: 'supplier:write', commandId: randomUUID(), baseVersion: null, action: 'save', draft: supplierInput, attachments: {} },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).id as string
}

async function snapshot(page: Page, id: string): Promise<SupplierCredentialSnapshot> {
  const response = await page.request.get(`/api/read/supplier-credentials/${id}?origin=real`)
  expect(response.ok(), await response.text()).toBe(true)
  return response.json()
}

for (const contractCase of [
  { name: '整数数量', qty: 2, price: 15, amount: 30, money: '¥30.00', signDate: '2026-09-11' },
  { name: '小数数量与闰日', qty: 0.5, price: 8, amount: 4, money: '¥4.00', signDate: '2024-02-29' },
]) {
  test(`分供方正式详情：六类事实、证照删除撤回和列表编辑回读：${contractCase.name}`, async ({ page }) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const supplierId = await createSupplier(page)
    const session = await (await page.request.get('/api/read/business-session')).json()
    const project = await page.request.post('/api/commands/projects', {
      data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: 'E2E分供方关联项目', manager: '合成经办', status: '筹备中' }, attachments: {} },
    })
    expect(project.ok(), await project.text()).toBe(true)
    const projectId = (await project.json()).id
    const contract = await page.request.post('/api/commands/material-contracts', {
      data: { ...session, requiredCapability: 'material-contract:write', commandId: randomUUID(), baseVersion: null, action: 'submit', draft: { name: 'E2E正式采购合同', projectId, supplierId, content: '合成材料采购', signDate: contractCase.signDate, amount: contractCase.amount, taxRate: null, lineItems: [{ materialName: '合成材料', unit: '根', qty: contractCase.qty, taxInclusiveUnitPrice: contractCase.price }] }, attachments: {} },
    })
    expect(contract.ok(), await contract.text()).toBe(true)
    const contractId = (await contract.json()).id

    await page.goto('/base/supplier')
    await page.getByPlaceholder('搜索关键词…').fill(supplierInput.name)
    await page.getByRole('link', { name: supplierInput.name, exact: true }).first().click()
    await expect(page).toHaveURL(url => url.pathname === `/base/supplier/${supplierId}` && url.searchParams.get('origin') === 'real')
    const tabs = page.getByRole('navigation', { name: '分供方业务事实' })
    await expect(tabs.getByRole('tab')).toHaveText(['详细资料', '合作项目 0', '支出合同 1', '支出结算 0', '收票登记 0', '付款管理 0'])
    for (const masked of ['138 **** 3456', '9144 **** 3456', '6228 **** 7788'])
      await expect(page.getByText(masked, { exact: true }).first()).toBeVisible()
    for (const raw of [supplierInput.contactPhone, supplierInput.taxNo, supplierInput.bankAccount])
      await expect(page.getByText(raw, { exact: true })).toHaveCount(0)
    const summary = page.getByTestId('supplier-summary')
    await expect(summary.getByRole('button', { name: '查看合作项目明细' })).toHaveText('0 个')
    await expect(summary.getByRole('button', { name: '查看累计合同金额明细' })).toHaveText(contractCase.money)
    for (const label of ['累计结算金额', '累计收票金额', '累计付款金额'])
      await expect(summary.getByRole('button', { name: `查看${label}明细` })).toHaveText('¥0.00')
    await expect(summary.locator('div').filter({ has: page.locator('dt', { hasText: /^应付金额$/ }) })).toContainText(contractCase.money)
    await expect(summary.getByRole('button', { name: '查看应付金额明细' })).toHaveCount(0)
    await summary.getByRole('button', { name: '查看累计合同金额明细' }).click()
    await expect(tabs.getByRole('tab', { name: /^支出合同\s*1$/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('link', { name: 'E2E正式采购合同', exact: true })).toHaveAttribute('href', `/contract/${contractId}?origin=real&contractKind=material`)
    for (const { metric, label, empty } of [
      { metric: '累计结算金额', label: /^支出结算\s*0$/, empty: '暂无结算事实' },
      { metric: '累计收票金额', label: /^收票登记\s*0$/, empty: '暂无归档收票' },
      { metric: '累计付款金额', label: /^付款管理\s*0$/, empty: '暂无付款事实' },
    ]) {
      await summary.getByRole('button', { name: `查看${metric}明细` }).click()
      await expect(tabs.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('status', { name: empty })).toBeVisible()
    }

    await page.getByRole('link', { name: '证照附件', exact: true }).click()
    for (const input of credentialInputs) {
      await page.getByRole('button', { name: '上传原件', exact: true }).click()
      const editor = page.getByRole('dialog', { name: '上传证照原件' })
      await editor.getByLabel('选择原件').setInputFiles({ name: input.fileName, mimeType: 'application/pdf', buffer: pdf })
      await editor.getByRole('combobox', { name: /^证照类别/ }).selectOption(input.category)
      await editor.getByRole('button', { name: '保存原件', exact: true }).click()
      await expect(editor).toBeHidden()
      await expect(page.getByRole('button', { name: `预览 ${input.fileName}`, exact: true })).toBeVisible()
    }
    expect((await snapshot(page, supplierId)).credentials).toHaveLength(credentialInputs.length)
    await page.getByRole('button', { name: '人工核验通过', exact: true }).click()
    const review = page.getByRole('dialog', { name: '人工核验通过' })
    await review.getByRole('button', { name: '确认通过', exact: true }).click()
    await expect(review).toBeHidden()
    const qualified = await snapshot(page, supplierId)
    expect(qualified.status).toBe('qualified')
    const bankFile = credentialInputs[2]!.fileName
    await page.getByRole('button', { name: `删除 ${bankFile}`, exact: true }).click()
    await page.getByRole('dialog', { name: '删除证照' }).getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.getByRole('button', { name: `预览 ${bankFile}`, exact: true })).toHaveCount(0)
    expect((await snapshot(page, supplierId)).status).toBe('incomplete')
    await page.getByRole('button', { name: '撤回本次删除', exact: true }).click()
    await page.getByRole('dialog', { name: '撤回本次删除' }).getByRole('button', { name: '确认撤回', exact: true }).click()
    await expect(page.getByRole('button', { name: `预览 ${bankFile}`, exact: true })).toBeVisible()
    const restored = await snapshot(page, supplierId)
    expect(restored.status).toBe('reviewing')
    expect(restored.credentials.map(row => row.id).sort()).toEqual(qualified.credentials.map(row => row.id).sort())

    await page.getByRole('link', { name: '返回分供方详情' }).click()
    const edit = page.getByRole('link', { name: '编辑分供方', exact: true })
    await edit.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(url => url.pathname === `/base/supplier/form/${supplierId}`)
    await page.getByLabel('主要联系人 *', { exact: true }).fill('E2E已更新联系人')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('E2E已更新联系人', { exact: true }).first()).toBeVisible()
    await page.reload()
    await expect(page.getByText('E2E已更新联系人', { exact: true }).first()).toBeVisible()
    await page.getByRole('link', { name: '返回分供方列表' }).click()
    await expect(page.getByPlaceholder('搜索关键词…')).toHaveValue(supplierInput.name)
    await page.getByRole('link', { name: supplierInput.name, exact: true }).first().click()
    await page.getByRole('link', { name: '编辑分供方', exact: true }).click()
    await expect(page.getByLabel('主要联系人 *', { exact: true })).toHaveValue('E2E已更新联系人')
    expect(errors).toEqual([])
  })
}

for (const tabCase of [
  { key: 'projects', label: /^合作项目\s*0$/, empty: '暂无合作项目' },
  { key: 'contracts', label: /^支出合同\s*0$/, empty: '暂无合同事实' },
  { key: 'invoices', label: /^收票登记\s*0$/, empty: '暂无归档收票' },
]) {
  test(`分供方事实页签深链刷新恢复：${tabCase.key}`, async ({ page }) => {
    const id = await createSupplier(page)
    await page.goto(`/base/supplier/${id}?origin=real&tab=${tabCase.key}`)
    const tab = page.getByRole('navigation', { name: '分供方业务事实' }).getByRole('tab', { name: tabCase.label, exact: true })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('status', { name: tabCase.empty })).toBeVisible()
    await page.reload()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('status', { name: tabCase.empty })).toBeVisible()
  })
}

test('正式分供方证照表在各宽度只在自身区域横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const id = await createSupplier(page)
  await page.goto(`/base/supplier/credential/${id}?origin=real`)
  const table = page.getByLabel('证照原件表，可横向滚动')
  await expect(table).toBeVisible()
  for (const width of RESPONSIVE_WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    if (width <= 768)
      await expectLocalHorizontalScroll(table, `${width}px 分供方证照表`)
    else
      await expect(table).toHaveCSS('overflow-x', 'auto')
    await expectNoPageOverflow(page, `${width}px 分供方证照页`)
  }
})
