import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
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
        if (path === '/project')
          await page.screenshot({ path: testInfo.outputPath('a01-project-status-1440.png') })
      })
    }
    expect(errors).toEqual([])
  })

  test('A02 采购列粘贴、手填单位、未填税率与联系人覆盖保存后保持', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
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
    await expect(page.locator('#section-lines')).toContainText('3 行 · 合计 4400.00 元')
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
      if (width === 390 || width === 1440)
        await page.screenshot({ path: testInfo.outputPath(`a02-form-${width}.png`) })
    }

    await page.getByLabel('合同名称 *').fill('A02 列粘贴合同')
    const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/material-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    const savedResponse = await saved
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

  test('列表进入演示详情，七页签、来源、关系与真实空态刷新保持', async ({ page }) => {
    await page.goto('/contract/material?search=瓷砖')
    await expect(page.getByTestId('material-contract-list').getByRole('heading', { name: '材料采购合同' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
    await expect(page).toHaveURL(/\/contract\/con_demo_cg01\?origin=demo&contractKind=material&returnTo=/)
    await expect(page.getByRole('heading', { name: '瓷砖采购合同' })).toBeVisible()
    await expect(page.getByText('演示只读')).toBeVisible()
    await expect(page.getByTestId('material-contract-edit')).toHaveCount(0)
    await expect(page.getByRole('link', { name: '合和新城' })).toHaveAttribute('href', '/project/proj_demo_001?origin=demo')
    await expect(page.getByRole('link', { name: '广东宏宇陶瓷有限公司' })).toHaveAttribute('href', '/base/supplier/sup_demo_007?origin=demo')
    await expect(page.getByRole('tab')).toHaveCount(7)
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

  test('受控迁入的既有正式合同按稳定 ID 刷新并进入显式编辑', async ({ page }) => {
    await page.goto('/contract/material?search=既有中央')
    await page.getByRole('link', { name: '既有中央材料采购合同' }).click()
    await expect(page).toHaveURL(/\/contract\/contract-existing-318\?origin=real&contractKind=material/)
    await expect(page.getByRole('heading', { name: '既有中央材料采购合同' })).toBeVisible()
    await page.reload()
    await page.getByTestId('material-contract-edit').click()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('既有中央材料采购合同')
    await page.getByLabel('【保存】后关闭').uncheck()
    await page.getByLabel('合同名称 *').fill('既有中央材料采购合同（留在表单）')
    const saved = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page).toHaveURL(/\/contract\/material\/form\/contract-existing-318/)
    await page.reload()
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

  test('正式合同经中央命令新建、详情、编辑与刷新闭合', async ({ page }) => {
    await page.goto('/contract/material/form')
    await expect(page.getByRole('heading', { name: /新建 · 材料采购合同/ })).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('合同名称 *').fill('中央正式瓷砖合同')
    await page.getByRole('combobox', { name: '检索项目' }).click()
    await page.getByText('中央正式材料项目').click()
    await page.getByRole('combobox', { name: '检索分供方' }).click()
    await page.getByText('中央正式材料供应商').click()
    await page.getByLabel('合同内容简述 *').fill('正式瓷砖采购')
    await page.getByLabel('签约日期 *').fill('2026-08-24')
    const created = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts') && response.request().method() === 'POST')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await created).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同' })).toBeVisible()
    await page.getByTestId('material-contract-edit').click()
    await page.getByLabel('合同名称 *').fill('中央正式瓷砖合同（已编辑）')
    const updated = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await updated).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同（已编辑）' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '中央正式瓷砖合同（已编辑）' })).toBeVisible()
  })

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

  for (const width of RESPONSIVE_WIDTHS) {
    test(`${width}px 列表、详情与宽表无页面级横滚`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto('/contract/material?search=瓷砖')
      await expect(page.getByTestId('material-contract-list')).toBeVisible({ timeout: 20_000 })
      await expectNoPageOverflow(page, `#318 列表 @ ${width}px`)
      await page.getByRole('link', { name: '瓷砖采购合同', exact: true }).click()
      await expect(page.getByTestId('material-contract-detail')).toBeVisible()
      await expectNoPageOverflow(page, `#318 详情 @ ${width}px`)
      await page.getByRole('tab', { name: /采购明细/ }).click()
      await expect(page.getByTestId('material-contract-lines-scroll')).toBeVisible()
      await expectNoPageOverflow(page, `#318 采购明细 @ ${width}px`)
    })
  }
})
