import type { Page, Request, Response } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const FORM_ROUTES = [
  {
    path: '/contract/construction/form',
    title: '新建 · 施工合同',
    field: '合同名称 *',
    editUrl: /\/contract\/construction\/form\/[^/?]+(?:\?|$)/,
  },
  {
    path: '/contract/subcontract/form',
    title: '新建 · 分包合同',
    field: '合同名称 *',
    editUrl: /\/contract\/subcontract\/form\/[^/?]+(?:\?|$)/,
  },
  {
    path: '/contract/material/form',
    title: '新建 · 材料采购合同',
    field: '合同名称 *',
    editUrl: /\/contract\/material\/form\/[^/?]+(?:\?|$)/,
  },
  {
    path: '/contract/other-expense/form',
    title: '新建 · 其他支出合同',
    field: '合同名称 *',
    editUrl: /\/contract\/other-expense\/form\/[^/?]+(?:\?|$)/,
  },
  {
    path: '/contract/company-expense/form',
    title: '新建 · 公司支出合同',
    field: '合同名称 *',
    editUrl: /\/contract\/company-expense\/form\/[^/?]+(?:\?|$)/,
  },
  {
    path: '/contract/other-settlement/form',
    title: '新建 · 其他支出结算',
    field: '结算名称 *',
    editUrl: /\/contract\/other-settlement\/form\/[^/?]+(?:\?|$)/,
  },
  {
    path: '/material/settlement/form',
    title: '新建 · 材料采购结算',
    field: '结算名称 *',
    editUrl: /\/material\/settlement\/form\/[^/?]+(?:\?|$)/,
  },
] as const

const MASTER_INPUTS = {
  project: 'F2 正式合成项目',
  customer: 'F2 正式合成客户',
  supplier: 'F2 正式合成分供方',
} as const

const masterIds = new WeakMap<Page, { project: string, customer: string, supplier: string }>()
const diagnosticTitles = new Set([
  '七条命名路由均可保存不完整草稿并进入真实编辑路由',
  '七条表单在响应式参考矩阵均无页面级横向溢出',
])
interface FormDiagnostics {
  pageErrors: string[]
  requestFailures: { url: string, method: string, resourceType: string, error: string | null }[]
  responseFailures: { url: string, status: number, resourceType: string }[]
  detach: () => void
}
const formDiagnostics = new WeakMap<Page, FormDiagnostics>()
function diagnosticUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  }
  catch { return '[无法解析的URL]' }
}
function observeFormDiagnostics(page: Page) {
  const diagnostics: FormDiagnostics = { pageErrors: [], requestFailures: [], responseFailures: [], detach: () => {} }
  const pageError = (error: Error) => {
    if (diagnostics.pageErrors.length < 100)
      diagnostics.pageErrors.push(error.message)
  }
  const requestFailed = (request: Request) => {
    if (diagnostics.requestFailures.length < 100)
      diagnostics.requestFailures.push({ url: diagnosticUrl(request.url()), method: request.method(), resourceType: request.resourceType(), error: request.failure()?.errorText ?? null })
  }
  const responseFailed = (response: Response) => {
    if (response.status() >= 400 && diagnostics.responseFailures.length < 100)
      diagnostics.responseFailures.push({ url: diagnosticUrl(response.url()), status: response.status(), resourceType: response.request().resourceType() })
  }
  page.on('pageerror', pageError)
  page.on('requestfailed', requestFailed)
  page.on('response', responseFailed)
  diagnostics.detach = () => {
    page.off('pageerror', pageError)
    page.off('requestfailed', requestFailed)
    page.off('response', responseFailed)
  }
  formDiagnostics.set(page, diagnostics)
}

async function chooseLookup(
  page: Page,
  label: string,
  keyword: string,
  optionText: string,
) {
  const input = page.getByLabel(label)
  await input.fill(keyword)
  await page.getByRole('option').filter({ hasText: optionText }).first().click()
}

test.describe('F2 canonical 合同与支出结算整页表单', () => {
  test.beforeEach(async ({ page }, info) => {
    if (diagnosticTitles.has(info.title))
      observeFormDiagnostics(page)
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `f2-${randomUUID()}` })
    const sessionResponse = await page.request.get('/api/read/business-session')
    expect(sessionResponse.ok()).toBe(true)
    const session = await sessionResponse.json()
    const ids = { project: '', customer: '', supplier: '' }
    for (const { key, domain, capability, draft } of [
      { key: 'customer', domain: 'customers', capability: 'customer:write', draft: { name: MASTER_INPUTS.customer } },
      { key: 'supplier', domain: 'suppliers', capability: 'supplier:write', draft: { name: MASTER_INPUTS.supplier, supplierCategory: '材料供应商', contact: '合成联系人' } },
    ] as const) {
      const response = await page.request.post(`/api/commands/${domain}`, {
        data: { ...session, requiredCapability: capability, commandId: randomUUID(), baseVersion: null, action: 'draft', draft, attachments: {} },
      })
      expect(response.ok(), await response.text()).toBe(true)
      ids[key] = (await response.json()).id
    }
    const project = await page.request.post('/api/commands/projects', { data: { ...session, requiredCapability: 'project:write', commandId: randomUUID(), baseVersion: null, action: 'draft', draft: { name: MASTER_INPUTS.project, manager: 'F2 合成经办人', customerId: ids.customer, status: '筹备中' }, attachments: {} } })
    expect(project.ok(), await project.text()).toBe(true)
    ids.project = (await project.json()).id
    masterIds.set(page, ids)
  })

  test.afterEach(async ({ page }, info) => {
    const diagnostics = formDiagnostics.get(page)
    if (!diagnostics)
      return
    try {
      if (info.status === info.expectedStatus)
        return
      let dom: unknown
      try {
        dom = await page.locator('body').evaluate(body => ({
          readyState: document.readyState,
          elementCount: body.querySelectorAll('*').length,
          bodyText: (() => {
            const copy = body.cloneNode(true)
            if (!(copy instanceof Element))
              return ''
            copy.querySelectorAll('script,style,template,noscript').forEach(node => node.remove())
            return (copy.textContent ?? '').slice(0, 4000)
          })(),
          headings: Array.from(body.querySelectorAll('h1,h2,h3,[role="heading"]'), node => node.textContent?.trim()),
          states: Array.from(body.querySelectorAll('[role="alert"],[role="status"]'), node => node.textContent?.trim()).slice(0, 20),
          nuxtRoot: (() => {
            const root = body.querySelector('#__nuxt')
            if (!root)
              return null
            const style = getComputedStyle(root)
            const rect = root.getBoundingClientRect()
            return { children: root.childElementCount, display: style.display, visibility: style.visibility, width: rect.width, height: rect.height }
          })(),
        }), undefined, { timeout: 2000 })
      }
      catch (cause) { dom = { error: cause instanceof Error ? cause.message : String(cause) } }
      await info.attach('f2-form-passive-diagnostic', { contentType: 'application/json', body: JSON.stringify({
        url: diagnosticUrl(page.url()),
        viewport: page.viewportSize(),
        pageErrors: diagnostics.pageErrors,
        requestFailures: diagnostics.requestFailures,
        responseFailures: diagnostics.responseFailures,
        dom,
      }) })
    }
    finally {
      diagnostics.detach()
      formDiagnostics.delete(page)
    }
  })

  test('七条命名路由均可保存不完整草稿并进入真实编辑路由', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })

    for (const [index, form] of FORM_ROUTES.entries()) {
      const name = `E2E-F2-草稿-${index}`
      await page.goto(form.path)
      await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator('[data-ui="entity-form-shell"]')).toBeVisible()
      await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button'))
        .toHaveText(['取消', '保存草稿', '保存并新建', '保存并提交', '保存'])

      await page.getByLabel(form.field, { exact: true }).fill(name)
      await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
      await page.getByRole('group', { name: '表单操作' })
        .getByRole('button', { name: '保存草稿' })
        .click()

      await expect(page).toHaveURL(form.editUrl)
      await expect(page.getByLabel(form.field, { exact: true })).toHaveValue(name, { timeout: 20_000 })
      await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
      await expectNoPageOverflow(page, form.path)
    }
  })

  for (const lineCase of [
    { name: '整数数量', qty: '3', price: '12.5', lineAmount: '37.50', importedQty: '2', importedPrice: '15', total: '67.50', arrival: '2026-08-01' },
    { name: '小数数量与闰日', qty: '0.5', price: '7.5', lineAmount: '3.75', importedQty: '1.25', importedPrice: '4', total: '8.75', arrival: '2028-02-29' },
  ]) {
    test(`材采明细新增、复制、删除与派生合计：${lineCase.name}`, async ({ page }) => {
      await page.goto('/contract/material/form')
      await expect(page.getByRole('navigation', { name: '表单分区' })).toBeVisible()
      await page.getByTestId('add-contract-line').click()
      await page.getByRole('textbox', { name: '物资名称，第 1 行' }).fill('E2E瓷砖')
      await page.getByRole('spinbutton', { name: '数量，第 1 行' }).fill(lineCase.qty)
      await page.getByRole('spinbutton', { name: '含税单价，第 1 行' }).fill(lineCase.price)
      await expect(page.getByText(lineCase.lineAmount, { exact: true })).toHaveCount(2)

      await page.getByRole('checkbox', { name: '选择第 1 行' }).check()
      await page.getByRole('button', { name: '复制选中' }).click()
      await expect(page.getByRole('textbox', { name: '物资名称，第 2 行' })).toHaveValue('E2E瓷砖')
      await page.getByRole('checkbox', { name: '选择第 1 行' }).check()
      await page.getByRole('button', { name: '删除选中' }).click()
      await expect(page.getByRole('textbox', { name: '物资名称，第 1 行' })).toHaveValue('E2E瓷砖')
      await expect(page.getByRole('textbox', { name: '物资名称，第 2 行' })).toHaveCount(0)

      await page.getByTestId('import-contract-lines').click()
      await page.getByTestId('contract-lines-tsv').fill(
        ['砂浆', 'M10', '品牌A', '包', lineCase.importedQty, lineCase.importedPrice, lineCase.arrival, 'TSV导入'].join('\t'),
      )
      await page.getByTestId('confirm-contract-lines-import').click()
      await expect(page.getByRole('textbox', { name: '物资名称，第 2 行' })).toHaveValue('砂浆')
      await expect(page.getByText(lineCase.total, { exact: true })).toHaveCount(1)
      await expect(page.getByLabel('计划到货日期，第 2 行')).toHaveValue(lineCase.arrival)
    })
  }

  test('材采提交会阻止空明细并聚焦首个无效单元格', async ({ page }) => {
    const ownName = 'F2空明细校验已核实我方主体'
    const ownId = await createVerifiedSignatory(page, ownName)
    await page.goto('/contract/material/form')
    await selectVerifiedSignatory(page, ownId, ownName)
    await page.getByTestId('contract-name').fill('E2E材采校验')
    await chooseLookup(page, '检索项目', MASTER_INPUTS.project, MASTER_INPUTS.project)
    await chooseLookup(page, '检索分供方', MASTER_INPUTS.supplier, MASTER_INPUTS.supplier)
    await page.getByTestId('contract-content').fill('E2E 材料采购内容')
    await page.getByTestId('contract-sign-date').fill('2026-07-30')
    await page.getByTestId('contract-amount').fill('100')
    await page.getByTestId('add-contract-line').click()

    const firstInvalidCell = page.getByRole('textbox', { name: '物资名称，第 1 行' })
    await page.getByRole('button', { name: '保存并提交' }).click()

    await expect(page).toHaveURL('/contract/material/form')
    await expect(firstInvalidCell).toHaveAttribute('aria-invalid', 'true')
    await expect(firstInvalidCell).toBeFocused()
    await expect(page.getByText('采购合同明细仍有必填项未填写', { exact: true })).toBeVisible()
  })

  test('保存并新建会在同一页可靠重置为空表单', async ({ page }) => {
    await page.goto('/contract/company-expense/form')
    await page.getByLabel('合同名称 *', { exact: true }).fill('E2E保存并新建')
    await page.getByLabel('对方单位 *').fill('E2E服务商')
    await page.getByLabel('签订日期 *').fill('2026-07-25')
    await page.getByLabel('合同金额 *', { exact: true }).fill('100')
    await page.getByRole('button', { name: '保存并新建' }).click()
    await expect(page).toHaveURL('/contract/company-expense/form')
    await expect(page.getByLabel('合同名称 *', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
  })

  test('真实 lookup、提交、附件删除恢复与其他支出结算链路成立', async ({ page }) => {
    test.setTimeout(120_000)
    const ownName = 'F2流程已核实我方主体'
    const ownId = await createVerifiedSignatory(page, ownName)
    const suffix = '独立合成链'
    const constructionName = `E2E施工提交-${suffix}`
    await page.goto('/contract/construction/form')
    await selectVerifiedSignatory(page, ownId, ownName)
    await page.getByTestId('contract-name').fill(constructionName)
    await chooseLookup(page, '检索项目', MASTER_INPUTS.project, MASTER_INPUTS.project)
    await chooseLookup(page, '检索客户', MASTER_INPUTS.customer, MASTER_INPUTS.customer)
    await page.getByTestId('contract-content').fill('E2E 施工内容')
    await page.getByTestId('contract-sign-date').fill('2026-07-25')
    await page.getByTestId('contract-amount').fill('100')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('contract-e2e'),
    })
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await expect(page).toHaveURL(/\/contract\/construction\/form\/[^/?]+(?:\?|$)/)
    await expect(page.getByRole('checkbox', { name: '【保存】后关闭' })).toBeChecked()
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await expect(page.getByRole('combobox', { name: '合同状态', exact: true })).toHaveText('审批中')
    await expect(page.getByText('e2e-contract.pdf', { exact: true })).toBeVisible()
    const constructionId = new URL(page.url()).pathname.split('/').at(-1)!
    const savedForm = await page.request.get(`/api/read/construction-contracts/${constructionId}/form`)
    expect(savedForm.ok()).toBe(true)
    expect((await savedForm.json()).draft).toMatchObject({ projectId: masterIds.get(page)!.project, customerId: masterIds.get(page)!.customer, amount: 100, status: '审批中' })

    const attachments = page.locator('#section-attachments')
    await attachments.getByRole('button', { name: '删除' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toBeVisible()
    await attachments.getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(attachments.getByText('已删除', { exact: true })).toHaveCount(0)

    const expenseName = `E2E其他支出-${suffix}`
    await page.goto('/contract/other-expense/form')
    await page.getByLabel('合同名称 *', { exact: true }).fill(expenseName)
    await chooseLookup(page, '检索项目', MASTER_INPUTS.project, MASTER_INPUTS.project)
    await chooseLookup(page, '检索分供方', MASTER_INPUTS.supplier, MASTER_INPUTS.supplier)
    await page.getByLabel('主要条款').fill('E2E 租赁服务')
    await page.getByLabel('签订日期 *').fill('2026-07-25')
    await page.getByLabel('合同金额 *', { exact: true }).fill('80')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    await page.getByRole('dialog', { name: '提交合同' }).getByRole('button', { name: '提交', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/other-expense\/form\/[^/?]+(?:\?|$)/)

    await page.locator('a[href="/contract/other-settlement"]').click()
    await page.getByRole('button', { name: '新建结算', exact: true }).click()
    await page.getByRole('combobox', { name: '结算来源', exact: true }).selectOption('contract')
    await page.getByLabel('结算名称 *', { exact: true }).fill(`E2E结算-${suffix}`)
    await chooseLookup(page, '检索项目', MASTER_INPUTS.project, MASTER_INPUTS.project)
    await chooseLookup(page, '检索其他支出合同', expenseName, expenseName)
    await page.getByLabel('含税结算金额 *').fill('60')
    await page.getByLabel('结算日期 *').fill('2026-07-25')
    await page.getByRole('checkbox', { name: '【保存】后关闭' }).uncheck()
    await page.getByRole('button', { name: '保存并提交' }).click()
    const settlementCommand = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/commands/other-settlements')
    await page.getByRole('dialog').getByRole('button', { name: '提交', exact: true }).click()
    const settlementResult = await settlementCommand
    expect(settlementResult.ok(), await settlementResult.text()).toBe(true)
    await expect(page).toHaveURL(/\/contract\/other-settlement\/form\/[^/?]+(?:\?|$)/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: '确认结算', exact: true })).toBeEnabled()
    const settlementId = new URL(page.url()).pathname.split('/').at(-1)!
    const settlementRead = await page.request.get(`/api/read/other-settlements/${settlementId}`, { params: { origin: 'real' } })
    expect(settlementRead.ok(), await settlementRead.text()).toBe(true)
    expect((await settlementRead.json()).settlement.draft).toMatchObject({ id: settlementId, status: 'pending', projectId: masterIds.get(page)!.project, totalAmount: 60 })
  })

  test('七条表单在响应式参考矩阵均无页面级横向溢出', async ({ page }) => {
    test.setTimeout(120_000)
    const widths = [...RESPONSIVE_WIDTHS, 1280].sort((a, b) => a - b)
    for (const form of FORM_ROUTES) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(form.path)
      for (const width of widths) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
          timeout: 20_000,
        })
        await expectNoPageOverflow(page, `${form.path} @ ${width}px`)
      }
    }
  })
})
