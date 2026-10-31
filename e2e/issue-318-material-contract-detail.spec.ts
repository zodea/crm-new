import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { installContractEngineeringFixture, selectContractEngineeringFixture } from './helpers/contract-engineering-fixture'
import { selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

type Scenario = 'ready' | 'empty' | 'forbidden' | 'unavailable' | 'demo-forbidden'
const DATA_VISIBILITY_STORAGE_KEY = 'ruihang:workspace-default:include-demo'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, scenario: Scenario = 'ready') {
  const response = await request.post('/api/testing/material-contracts/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #318：材料采购合同中央只读详情', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), DATA_VISIBILITY_STORAGE_KEY)
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
    const headers = { 'x-ruihang-test-session': id }
    const context = await (await page.request.get('/api/read/material-contracts/form-context', { headers })).json()
    const own = await page.request.post('/api/commands/our-signatories', { headers, data: { workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'our-signatory:write', commandId: `our-${id}`, baseVersion: null, draft: { name: 'A02明确核实我方公司', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '隔离浏览器合成文书核实', status: 'active' } } })
    expect(own.ok()).toBe(true)
  })

  test('A02 材质与独立减项实际保存，协议读回聚焦，真实零和未知金额保持区分', async ({ page }, testInfo) => {
    test.setTimeout(150_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const id = session(testInfo)
    const headers = { 'x-ruihang-test-session': id }
    const contextResponse = await page.request.get('/api/read/material-contracts/form-context', { headers })
    expect(contextResponse.ok()).toBe(true)
    const context = await contextResponse.json()
    const own = (await (await page.request.get('/api/read/our-signatories', { headers })).json()).records[0]
    const envelope = { workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'material-contract:write', baseVersion: null, attachments: {}, action: 'submit' }
    const supplier = await page.request.post('/api/commands/suppliers', { headers, data: { ...envelope, requiredCapability: 'supplier:write', action: 'draft', commandId: `${id}-supplier-owned`, draft: { name: 'A02自有明细分供方', supplierCategory: '材料供应商' } } })
    expect(supplier.ok()).toBe(true)
    const project = await page.request.post('/api/commands/projects', { headers, data: { ...envelope, requiredCapability: 'project:write', action: 'draft', commandId: `${id}-project-owned`, draft: { name: 'A02自有材采项目' } } })
    expect(project.ok()).toBe(true)
    const draft = { name: 'A02自有材采', ourSignatoryId: own.id, ourSignatoryVersion: own.version, projectId: (await project.json()).id, supplierId: (await supplier.json()).id, content: '方管原签约事实', signDate: '2026-10-04', amount: 4800, taxRate: null, lineItems: [{ materialName: '方管A', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 20 }, { materialName: '方管B', materialGrade: '', unit: '米', qty: 100, taxInclusiveUnitPrice: 30 }], deductions: [{ name: '整单优惠', amount: 200, basis: '原件优惠200元' }] }
    const create = await page.request.post('/api/commands/material-contracts', { headers, data: { ...envelope, commandId: `${id}-main-owned`, draft } })
    expect(create.ok()).toBe(true)
    const saved = await create.json()
    const formResponse = await page.request.get(`/api/read/material-contracts/${saved.id}/form`, { headers })
    expect(formResponse.ok()).toBe(true)
    const form = await formResponse.json()
    const protocolResponse = await page.request.post('/api/commands/material-contracts', { headers, data: { ...envelope, commandId: `${id}-protocol-owned`, draft: { ...draft, name: 'A02原行核增协议', isSupplement: true, originalContractId: saved.id, amount: 100, deductions: [], lineItems: [{ materialName: '方管A', materialGrade: '304', unit: '米', qty: 100, taxInclusiveUnitPrice: 21, originalLineId: form.draft.lineItems[0].id, changeAmount: 100, changeBasis: '原100米每米增1元' }] } } })
    expect(protocolResponse.ok()).toBe(true)
    const protocol = await protocolResponse.json()
    // 使用默认ready来源，验证真实HTTP组合保留新增协议/减项，不能只测空场景的纯DTO构建。
    const read = await page.request.get(`/api/read/material-contracts/${saved.id}?origin=real`, { headers })
    expect(read.ok()).toBe(true)
    expect(await read.json()).toMatchObject({ contract: { amounts: { contract: '4800.00', changed: '4900.00' } }, sections: { deductions: [{ amount: '-200.00' }], supplements: [{ id: protocol.id, lineItems: [{ originalLineId: form.draft.lineItems[0].id, amount: '100.00' }], originalLineSnapshots: [{ parentVersion: 1, unitPrice: '20.00' }] }] } })
    await page.goto(`/contract/material/form/${saved.id}`)
    await expect(page.getByLabel('合同名称 *')).toHaveValue('A02自有材采', { timeout: 20_000 })
    await selectVerifiedSignatory(page, own.id, 'A02明确核实我方公司')
    await expect(page.getByLabel('扣减金额，第 1 行')).toHaveValue('200')
    const grade = page.getByLabel('材质，第 1 行', { exact: true })
    await expect(grade).toHaveValue('304')
    await grade.fill('316')
    await page.getByLabel('扣减金额，第 1 行').fill('300')
    await page.getByTestId('contract-amount').fill('4700')
    const updated = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`/api/commands/material-contracts/${saved.id}`))
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存并提交', exact: true }).click()
    expect((await updated).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'A02自有材采', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: /^采购明细/ }).click()
    await expect(page.getByTestId('material-contract-lines-scroll')).toContainText('316')
    await expect(page.getByText('整单优惠')).toBeVisible()
    await expect(page.getByText('¥-300.00', { exact: true })).toBeVisible()
    await page.goto(`/contract/${saved.id}?origin=real&contractKind=material&tab=supplements&supplementId=${protocol.id}`)
    const protocolCard = page.locator(`#material-contract-supplement-${protocol.id}`)
    await expect(protocolCard).toBeFocused()
    await expect(protocolCard).toContainText('原签约依据（版本 1）')
    await expect(protocolCard).toContainText('¥20.00')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `材采协议与原依据 ${width}px`)
      await protocolCard.focus()
      await expect(protocolCard).toBeFocused()
    }
    await protocolCard.getByRole('button', { name: '编辑协议' }).click()
    await expect(page.getByLabel('协议名称 *')).toHaveValue('A02原行核增协议')
    await page.getByLabel('协议名称 *').fill('A02原行核增协议已核对')
    const updateProtocol = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().includes(`/api/commands/material-contracts/${protocol.id}`))
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await updateProtocol).ok()).toBe(true)
    await expect(page.locator(`#material-contract-supplement-${protocol.id}`)).toContainText('A02原行核增协议已核对')
    for (const [amount, name] of [[0, 'A02真实零合同'], [null, 'A02未知合同']] as const) {
      const response = await page.request.post('/api/commands/material-contracts', { headers, data: { ...envelope, action: 'draft', commandId: `${id}-${name}`, draft: { ...draft, name, amount, lineItems: [], deductions: [] } } })
      expect(response.ok()).toBe(true)
      const result = await response.json()
      const detail = await page.request.get(`/api/read/material-contracts/${result.id}?origin=real`, { headers })
      expect(await detail.json()).toMatchObject({ contract: { amounts: { contract: amount === null ? null : '0.00', changed: amount === null ? null : '0.00' } } })
    }
    await page.goto('/contract/material?search=A02未知合同&origin=real')
    await expect(page.getByTestId('material-contract-list')).toContainText('待核实')
    expect(errors).toEqual([])
  })

  test('A02 真实文件映射与整批修错追加保存原件，既有行保留且读取字节核摘要', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await installContractEngineeringFixture(page, 'material', '中央正式材料项目')
    await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const headers = { 'x-ruihang-test-session': session(testInfo) }
    const payload = Buffer.from('材料名称,材质,单位,数量,含税单价,计价单位\n新增方管A,304,米,10,2,米\n新增方管B,,米,错误数量,3,米\n', 'utf8')
    const hash = createHash('sha256').update(payload).digest('hex')
    await page.goto('/contract/material/form')
    await expect(page.getByRole('heading', { name: /新建 · 材料采购合同/ })).toBeVisible({ timeout: 20_000 })
    await selectContractEngineeringFixture(page)
    await page.getByLabel('合同名称 *').fill('A02真实文件追加合同')
    await page.getByTestId('add-contract-line').click()
    await page.getByLabel('物资名称，第 1 行', { exact: true }).fill('保留既有材料')
    await page.getByLabel('单位，第 1 行', { exact: true }).fill('米')
    await page.getByTestId('material-contract-file').setInputFiles({ name: '真实材采.csv', mimeType: 'text/plain', buffer: payload })
    for (const label of ['材料名称', '材质', '单位', '数量', '含税单价', '计价单位'])
      await page.getByLabel(`${label}来源列`, { exact: true }).selectOption({ label })
    await page.getByTestId('material-contract-preview').click()
    const append = page.getByTestId('material-contract-append-import')
    await expect(append).toBeDisabled()
    await page.getByLabel('数量与单位已核实，源第 2 行').check()
    await expect(append).toBeDisabled()
    await page.getByLabel('数量，源第 3 行', { exact: true }).fill('5')
    await page.getByLabel('数量与单位已核实，源第 3 行').check()
    await expect(append).toBeEnabled()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `材采文件预览 ${width}px`)
      await page.getByLabel('材料导入预览横向滚动').focus()
      await expect(page.getByLabel('材料导入预览横向滚动')).toBeFocused()
    }
    await append.click()
    await expect(page.getByText('已整批追加到当前合同草稿，请保存合同完成写入')).toBeVisible()
    await expect(page.getByLabel('物资名称，第 1 行', { exact: true })).toHaveValue('保留既有材料')
    await expect(page.getByLabel('物资名称，第 2 行', { exact: true })).toHaveValue('新增方管A')
    await expect(page.getByLabel('材质，第 3 行', { exact: true })).toHaveValue('')
    await page.getByTestId('contract-amount').fill('35')
    const posted = page.waitForResponse(response => response.url().endsWith('/api/commands/material-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    const response = await posted
    expect(response.ok()).toBe(true)
    const result = await response.json()
    const form = await (await page.request.get(`/api/read/material-contracts/${result.id}/form`, { headers })).json()
    expect(form.draft.lineItems).toMatchObject([{ materialName: '保留既有材料' }, { materialName: '新增方管A', materialGrade: '304', qty: 10, source: { sourceHash: hash, rowNumber: 2, fileName: '真实材采.csv' } }, { materialName: '新增方管B', materialGrade: '', qty: 5, source: { sourceHash: hash, rowNumber: 3 } }])
    expect(new Set(form.draft.lineItems.map((line: { id: string }) => line.id)).size).toBe(3)
    const originalResponse = await page.request.get(`/api/read/material-contracts/${result.id}/files/${result.attachmentIds[0]}?origin=real`, { headers })
    expect(originalResponse.ok()).toBe(true)
    const original = await originalResponse.json()
    expect(original.sha256).toBe(hash)
    expect(Buffer.from(original.payloadBase64, 'base64')).toEqual(payload)
    await expect(page.getByRole('heading', { name: 'A02真实文件追加合同', exact: true })).toBeVisible()
    const files = page.getByLabel('合同原件附件')
    const download = page.waitForEvent('download')
    await files.getByRole('button', { name: '下载', exact: true }).click()
    const downloaded = await download
    const chunks: Buffer[] = []
    for await (const chunk of (await downloaded.createReadStream())!)
      chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(payload)
    expect(errors).toEqual([])
  })

  test('A01 项目、合同与排程状态使用紧凑标签并保持各视口局部滚动', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const projects = await page.request.post('/api/testing/projects/reset', {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session(testInfo) },
      data: { scenario: 'ready' },
    })
    expect(projects.ok()).toBe(true)
    for (const path of [
      '/project',
      '/project/proj_demo_001?origin=demo',
      '/contract/material',
      '/contract/con_demo_cg01?origin=demo&contractKind=material',
      '/?project=proj_demo_001&origin=demo',
      '/schedule?project=proj_demo_001&origin=demo',
    ]) {
      await test.step(path, async () => {
        await page.goto(path)
        const tag = page.locator('[data-ui="status-tag"]').first()
        await expect(tag).toBeVisible({ timeout: 45_000 })
        expect(await tag.evaluate(element => ({
          radius: getComputedStyle(element).borderRadius,
          lineHeight: getComputedStyle(element).lineHeight,
        }))).toEqual({ radius: '2px', lineHeight: '14px' })
        for (const width of [390, 768, 1024, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await expectNoPageOverflow(page, `${path} ${width}px`)
        }
      })
    }
    expect(errors).toEqual([])
  })

  test('A02 采购列粘贴、手填单位、未填税率与联系人覆盖保存后保持', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await installContractEngineeringFixture(page, 'material', '中央正式材料项目')
    const id = session(testInfo)
    const request = page.context().request
    for (const [index, contact, contactPhone] of [[1, '主档联系人', '13800000001'], [2, '', '']] as const) {
      const created = await request.post('/api/commands/suppliers', {
        headers: { 'x-ruihang-test-session': id },
        data: {
          workspaceId: 'workspace-default',
          actorId: 'actor-default',
          requiredCapability: 'supplier:write',
          commandId: `${id}-supplier-${index}`,
          baseVersion: null,
          action: 'draft',
          attachments: {},
          draft: { name: `列粘贴分供方${index}`, supplierCategory: '材料供应商', contact, contactPhone, phone: '02088888888' },
        },
      })
      expect(created.ok()).toBe(true)
    }
    await page.goto('/contract/material/form')
    await expect(page.getByRole('heading', { name: /新建 · 材料采购合同/ })).toBeVisible({ timeout: 20_000 })
    await selectContractEngineeringFixture(page)
    await expect(page.getByRole('combobox', { name: '税率', exact: true })).toHaveText('未填写')
    const taxAmount = page.locator('.field-block').filter({ has: page.locator('.field-label', { hasText: /^税额$/ }) })
    const netAmount = page.locator('.field-block').filter({ has: page.locator('.field-label', { hasText: /^无税金额$/ }) })
    for (const { amount, rate, net, tax } of [
      { amount: '113', rate: '13%', net: '100.00', tax: '13.00' },
      { amount: '109', rate: '9%', net: '100.00', tax: '9.00' },
      { amount: '2200', rate: '0%', net: '2200.00', tax: '0.00' },
      { amount: '4400', rate: '未填写', net: '4400.00', tax: '0.00' },
    ]) {
      await page.getByTestId('contract-amount').fill(amount)
      await page.getByRole('combobox', { name: '税率', exact: true }).click()
      await page.getByRole('option', { name: rate, exact: true }).click()
      await expect(taxAmount.locator('.field-readonly')).toHaveText(tax)
      await expect(netAmount.locator('.field-readonly')).toHaveText(net)
    }
    await page.getByRole('combobox', { name: '检索分供方' }).click()
    await page.getByRole('option').filter({ hasText: '列粘贴分供方1' }).click()
    await expect(page.getByLabel('履约联系人', { exact: true })).toHaveValue('主档联系人')
    await expect(page.getByLabel('联系方式', { exact: true })).toHaveValue('13800000001')
    await page.getByLabel('履约联系人', { exact: true }).fill('手填联系人')
    await page.getByRole('combobox', { name: '检索分供方' }).fill('列粘贴分供方2')
    await page.getByRole('option').filter({ hasText: '列粘贴分供方2' }).click()
    await expect(page.getByLabel('履约联系人', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('联系方式', { exact: true })).toHaveValue('')
    await page.getByLabel('履约联系人', { exact: true }).fill('合同独立联系人')

    await page.getByTestId('add-contract-line').click()
    await page.getByTestId('add-contract-line').click()
    const cell = (row: number, key: string) => page.locator(`[data-kit-grid-cell="${row}:${key}"]`)
    const paste = async (row: number, key: string, text: string) => {
      await cell(row, key).focus()
      await cell(row, key).evaluate((element, text) => {
        const clipboardData = new DataTransfer()
        clipboardData.setData('text/plain', text)
        element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
      }, text)
    }
    await paste(0, 'materialName', '方管 A\n方管 B\n')
    await paste(0, 'spec', '40×40\n\n50×50\n')
    await expect(cell(1, 'spec')).toHaveValue('')
    await expect(cell(2, 'spec')).toHaveValue('50×50')
    await expect(cell(0, 'materialName')).toHaveValue('方管 A')
    await expect(cell(1, 'materialName')).toHaveValue('方管 B')
    await expect(cell(0, 'unit')).toHaveValue('')
    await paste(0, 'unit', '米\n根\n')
    await paste(0, 'qty', '100\n80\n')
    await paste(0, 'taxInclusiveUnitPrice', '20\n30\n')
    // 原断言保护两条已知量价；第三行缺量价须保持未知，不补零形成完整合计。
    await expect(page.locator('#section-lines')).toContainText('3 行 · 合计 待完善')
    for (const invalidNumber of ['无效', 'Infinity', '1,200', '0x10']) {
      await paste(0, 'qty', `200\n${invalidNumber}\n`)
      await expect(page.locator('#section-lines').getByRole('alert')).toContainText('本次粘贴未应用')
      await expect(cell(0, 'qty')).toHaveValue('100')
      await expect(cell(1, 'qty')).toHaveValue('80')
    }
    await paste(0, 'plannedArrivalDate', '2026-10-03\n2026-10-04\n')
    await expect(cell(1, 'plannedArrivalDate')).toHaveValue('2026-10-04')
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `采购列粘贴 ${width}px`)
      await cell(0, 'unit').focus()
      await expect(cell(0, 'unit')).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(cell(0, 'qty')).toBeFocused()
    }

    await page.getByLabel('合同名称 *').fill('A02 列粘贴合同')
    const saved = Promise.race([
      page.waitForResponse(response => response.url().endsWith('/api/commands/material-contracts') && response.request().method() === 'POST').then(response => ({ response })),
      new Promise<{ error: string }>(resolve => page.once('pageerror', error => resolve({ error: error.message }))),
    ])
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    const outcome = await saved
    expect('error' in outcome ? outcome.error : null).toBeNull()
    if (!('response' in outcome))
      throw new Error(outcome.error)
    const savedResponse = outcome.response
    expect(savedResponse.ok()).toBe(true)
    expect(savedResponse.request().postDataJSON().draft).toMatchObject({ amount: 4400, taxRate: null })
    const result = await savedResponse.json()
    await page.goto(`/contract/material/form/${result.id}`)
    await expect(page.getByLabel('合同名称 *')).toHaveValue('A02 列粘贴合同')
    await expect(page.getByLabel('履约联系人', { exact: true })).toHaveValue('合同独立联系人')
    await expect(page.getByRole('combobox', { name: '税率', exact: true })).toHaveText('未填写')
    await expect(taxAmount.locator('.field-readonly')).toHaveText('0.00')
    await expect(netAmount.locator('.field-readonly')).toHaveText('4400.00')
    await expect(cell(1, 'unit')).toHaveValue('根')
    await expect(cell(1, 'qty')).toHaveValue('80')
    await expect(cell(2, 'spec')).toHaveValue('50×50')
    await page.goto(`/contract/${result.id}?origin=real&contractKind=material`)
    await expect(page.getByRole('heading', { name: 'A02 列粘贴合同', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'A02 列粘贴合同', exact: true })).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('material-contract-edit').click()
    await expect(page.getByLabel('履约联系人', { exact: true })).toHaveValue('合同独立联系人')
    await expect(cell(1, 'plannedArrivalDate')).toHaveValue('2026-10-04')
  })

  test('列表进入演示详情，八页签、来源、关系与真实空态刷新保持', async ({ page }) => {
    await page.goto('/contract/material?search=瓷砖')
    await expect(page.getByTestId('material-contract-list').getByRole('heading', { name: '材料采购合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/con_demo_cg01\?origin=demo&contractKind=material&returnTo=/)
    await expect(page.getByRole('heading', { name: '瓷砖采购合同' })).toBeVisible()
    await expect(page.getByText('演示只读')).toBeVisible()
    await expect(page.getByTestId('material-contract-edit')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')
    await expect(page.getByRole('link', { name: '广东宏宇陶瓷有限公司' })).toHaveAttribute('href', '/base/supplier/sup_demo_007?origin=demo')
    await expect(page.getByRole('tab')).toHaveText(['详细信息', /\s*采购明细 \d+\s*/, '补充协议 0', '材料管理', /\s*发票登记 \d+\s*/, /\s*付款信息 \d+\s*/, /\s*支出结算 \d+\s*/, /\s*项目扣罚 \d+\s*/])
    await page.getByRole('tab', { name: /材料管理/ }).click()
    await expect(page).toHaveURL(/tab=materials/)
    await expect(page.getByRole('status', { name: '暂无关联直调记录' })).toBeVisible()
    await expect(page.getByRole('status', { name: '暂无关联出库记录' })).toBeVisible()
    await page.getByRole('tab', { name: /发票登记/ }).click()
    await expect(page.getByText('瓷砖首期收票')).toBeVisible()
    await expect(page.getByRole('link', { name: '瓷砖首期收票' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText('瓷砖首期收票')).toBeVisible()
    await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
    await expect(page.getByLabel('搜索材料采购合同')).toHaveValue('瓷砖')
  })

  test('受控迁入的既有正式合同按稳定 ID 刷新并进入显式编辑', async ({ page }, testInfo) => {
    await page.goto('/contract/material?search=既有中央')
    await page.getByRole('link', { name: '既有中央材料采购合同' }).click()
    await expect(page).toHaveURL(/\/contract\/contract-existing-318\?origin=real&contractKind=material/)
    await expect(page.getByRole('heading', { name: '既有中央材料采购合同' })).toBeVisible()
    await page.reload()
    await page.getByTestId('material-contract-edit').click()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央材料采购合同')
    // 原断言保护迁入ID及编辑回读；按现行正式保存规则，人工采用已核实主体。
    const own = (await (await page.request.get('/api/read/our-signatories', { headers: { 'x-ruihang-test-session': session(testInfo) } })).json()).records[0]
    await selectVerifiedSignatory(page, own.id, 'A02明确核实我方公司')
    await page.getByLabel('【保存】后关闭').uncheck()
    await page.getByLabel('合同名称 *').fill('既有中央材料采购合同（留在表单）')
    const saved = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page).toHaveURL(/\/contract\/material\/form\/contract-existing-318/)
    await expect(page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央材料采购合同（留在表单）')
    await page.reload()
    await page.goto('/contract/contract-existing-318?origin=real&contractKind=material')
    await expect(page.getByRole('heading', { name: '既有中央材料采购合同（留在表单）', exact: true })).toBeVisible()
    await page.getByTestId('material-contract-edit').click()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央材料采购合同（留在表单）')
  })

  test('无效查询显式报错；保留旧列表的刷新失败仍可见并可重试', async ({ page }, testInfo) => {
    await page.goto('/contract/material?pageSize=13')
    await expect(page.getByText('材料采购合同查询条件无效')).toBeVisible()
    await page.getByRole('button', { name: '清除无效条件' }).click()
    await expect(page.getByRole('link', { name: '瓷砖采购合同', exact: true })).toBeVisible()

    const id = session(testInfo)
    await reset(page.context().request, id, 'unavailable')
    await page.getByLabel('搜索材料采购合同').fill('瓷砖')
    await expect(page.getByRole('alert')).toContainText('当前保留上一次成功读取的列表')
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  // 正式新建、编辑及刷新闭环由 production-our-signatories 的隔离生产来源测试承接，含施工主合同关系回读。

  test('HTTP 接缝明确区分禁止、暂不可用、缺失、来源错配与演示未授权', async ({ page }, testInfo) => {
    const id = session(testInfo)
    const request = page.context().request
    const cases = [
      ['/api/read/material-contracts/missing?origin=real', 404, 'not-found'],
      ['/api/read/material-contracts/con_demo_cg01?origin=real&includeDemo=true', 404, 'relationship-mismatch'],
    ] as const
    for (const [url, status, code] of cases) {
      const response = await request.get(url, { headers: { 'x-ruihang-test-session': id } })
      expect(response.status()).toBe(status)
      expect(await response.json()).toMatchObject({ data: { code } })
    }
    await reset(request, id, 'demo-forbidden')
    const demo = await request.get('/api/read/material-contracts/con_demo_cg01?origin=demo&includeDemo=true', { headers: { 'x-ruihang-test-session': id } })
    expect(demo.status()).toBe(403)
    await reset(request, id, 'forbidden')
    await page.goto('/contract/material')
    await expect(page.getByText('无材料采购合同查看权限')).toBeVisible()
    await reset(request, id, 'unavailable')
    await page.goto('/contract/con_demo_cg01?origin=demo&contractKind=material')
    await expect(page.getByText('材料采购合同中央读取服务暂时不可用')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible()
  })

  test('列表、详情与宽表在各宽度无页面级横滚', async ({ page }) => {
    const expectNoOverflowAcrossWidths = async (label: string) => {
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
        await expectNoPageOverflow(page, `#318 ${label} @ ${width}px`)
      }
    }
    await page.goto('/contract/material?search=瓷砖')
    await expect(page.getByTestId('material-contract-list')).toBeVisible({ timeout: 20_000 })
    await expectNoOverflowAcrossWidths('列表')
    await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
    await expect(page.getByTestId('material-contract-detail')).toBeVisible()
    await expectNoOverflowAcrossWidths('详情')
    await page.getByRole('tab', { name: /采购明细/ }).click()
    await expect(page.getByTestId('material-contract-lines-scroll')).toBeVisible()
    await expectNoOverflowAcrossWidths('采购明细')
  })
})
