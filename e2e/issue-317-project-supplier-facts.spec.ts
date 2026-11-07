import type { APIRequestContext, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

const STORAGE_KEY = 'ruihang:workspace-default:include-demo'
const WORKBENCH = '/project/proj_demo_002/supplier/sup_demo_004?origin=demo&tab=overview'

function session(testInfo: TestInfo) {
  return Buffer.from(testInfo.testId, 'utf8').toString('base64url')
}

async function reset(request: APIRequestContext, id: string, scenario: 'ready' | 'formal-ready' | 'zero' | 'forbidden' | 'unavailable' = 'ready') {
  const response = await request.post('/api/testing/project-suppliers/reset', {
    headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': id },
    data: { scenario },
  })
  expect(response.ok()).toBe(true)
}

test.describe('Issue #317：项目分供方六类事实工作台', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const id = session(testInfo)
    await page.addInitScript(key => localStorage.setItem(key, 'true'), STORAGE_KEY)
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': id })
    await reset(page.context().request, id)
  })

  test('六类事实与汇总可见，项目来源刷新后返回工作台', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('¥230,000.00', { exact: true }).first()).toBeVisible()
    for (const tab of ['合作概览', '合同', '请款', '收票', '付款', '结算'])
      await expect(page.getByRole('tab', { name: new RegExp(tab) })).toBeVisible()

    const projectIdentity = page.getByRole('link', { name: '锦绣华庭', exact: true })
    await expect(projectIdentity).toHaveAttribute('href', /\/project\/proj_demo_002\?origin=demo&returnTo=/)
    await projectIdentity.click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\?origin=demo&returnTo=/)
    await expect(page.getByRole('heading', { name: '锦绣华庭' })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\?origin=demo&returnTo=/)
    await page.getByRole('link', { name: '返回项目分供方工作台' }).click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\/supplier\/sup_demo_004\?origin=demo&tab=overview$/)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible()
  })

  test('分供方来源刷新后返回工作台', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    const supplierIdentity = page.getByRole('link', { name: '穗建五金机电经营部', exact: true })
    await expect(supplierIdentity).toHaveAttribute('href', /\/base\/supplier\/sup_demo_004\?origin=demo&returnTo=/)
    await supplierIdentity.click()
    await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004\?origin=demo&returnTo=/)
    await expect(page.getByRole('heading', { name: '穗建五金机电经营部' })).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/\/base\/supplier\/sup_demo_004\?origin=demo&returnTo=/)
    await page.getByRole('link', { name: '返回项目分供方工作台' }).click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\/supplier\/sup_demo_004\?origin=demo&tab=overview$/)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible()
  })

  test('合同源单返回后刷新保留标签', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /^合同/ }).click()
    await expect(page).toHaveURL(/tab=contract/)
    const contractSource = page.getByRole('link', { name: '查看源单' }).first()
    await expect(contractSource).toHaveAttribute('href', /\/contract\/con_demo_cg07\?.*projectId=proj_demo_002.*supplierId=sup_demo_004.*returnTo=/)
    await contractSource.click()
    await expect(page.getByRole('heading', { name: /五金机电/ })).toBeVisible()
    await page.getByRole('link', { name: '返回项目分供方工作台' }).click()
    await expect(page).toHaveURL(/\/project\/proj_demo_002\/supplier\/sup_demo_004\?origin=demo&tab=contract$/)
    await expect(page.getByRole('tab', { name: /^合同/ })).toHaveAttribute('aria-selected', 'true')
    await page.reload()
    await expect(page.getByRole('tab', { name: /^合同/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('请款刷新恢复及收票、付款、结算显示待核验状态', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByRole('heading', { name: '锦绣华庭 × 穗建五金机电经营部' })).toBeVisible({ timeout: 20_000 })
    await page.getByRole('tab', { name: /^请款/ }).click()
    await expect(page.getByText('来源待核验').first()).toBeVisible()
    await expect(page.getByRole('link', { name: '查看源单' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /^请款/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=claim/)
    await page.reload()
    await expect(page.getByRole('tab', { name: /^请款/ })).toHaveAttribute('aria-selected', 'true')
    for (const tab of ['收票', '付款', '结算']) {
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
      await expect(page.getByText('目标待核验').first()).toBeVisible()
      await expect(page.getByRole('link', { name: '查看源单' })).toHaveCount(0)
    }
    await expect(page.getByText('2 份', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '查看来源' }).first()).toHaveAttribute('href', /returnTo=/)
  })

  test('显式正式中央实例提供六类非零事实且不回退本地来源', async ({ page }, testInfo) => {
    await reset(page.context().request, session(testInfo), 'formal-ready')
    await page.goto('/project/project-real-317/supplier/supplier-real-317?tab=overview')
    await expect(page.getByRole('heading', { name: '中央正式项目 × 中央正式分供方' })).toBeVisible({ timeout: 20_000 })
    for (const tab of ['合同1', '请款1', '收票1', '付款1', '结算1'])
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()
    await page.getByRole('tab', { name: '合同1' }).click()
    await expect(page.getByLabel('合同事实').getByText('目标待核验')).toBeVisible()
    await expect(page.getByRole('link', { name: '查看源单' })).toHaveCount(0)
  })

  for (const input of [
    { label: '材料供应候选', supplierName: '中央合成材料供应候选', fileName: '中央合成材料供应候选-合同.pdf' },
    { label: '工程服务候选', supplierName: '中央合成工程服务候选', fileName: '中央合成工程服务候选-合同.pdf' },
  ]) {
    test(`正式项目导入只在确认时原子提交中央身份、关系与文件元数据，刷新仍可读取：${input.label}`, async ({ page }, testInfo) => {
      test.setTimeout(60_000)
      const prepared = await page.request.post('/api/testing/construction-contracts/reset', {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session(testInfo) },
        data: { scenario: 'ready' },
      })
      expect(prepared.ok()).toBe(true)
      const projectPath = '/project/project-real-320?origin=real'
      const { fileName, supplierName } = input

      await page.goto(projectPath)
      await expect(page.getByRole('heading', { name: '中央正式施工项目' })).toBeVisible({ timeout: 20_000 })
      const projectSuppliers = page.getByRole('region', { name: '项目分供方' })
      await projectSuppliers.getByRole('link', { name: '从文件导入分供方' }).click()
      await expect(page).toHaveURL('/project/project-real-320/supplier/import?origin=real')

      const chooserPromise = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '选择文件', exact: true }).click()
      const chooser = await chooserPromise
      await chooser.setFiles({
        name: fileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 central project supplier import'),
      })
      await page.getByRole('button', { name: '下一步：自动分类' }).click()
      const candidate = page.locator('article').filter({ hasText: fileName })
      await candidate.getByRole('textbox', { name: /新分供方名称/ }).fill(supplierName)
      await candidate.getByRole('checkbox').check()
      await page.getByRole('button', { name: '下一步：确认生成' }).click()
      await page.getByRole('button', { name: '确认生成并返回项目' }).click()

      await expect(page).toHaveURL(projectPath)
      const imported = page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: supplierName })
      await expect(imported).toBeVisible({ timeout: 20_000 })
      await imported.click()
      await expect(page.getByRole('heading', { name: `中央正式施工项目 × ${supplierName}` })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(fileName, { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText(fileName, { exact: true })).toBeVisible({ timeout: 20_000 })

      await page.getByRole('link', { name: supplierName, exact: true }).click()
      await expect(page.getByRole('heading', { name: supplierName })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('link', { name: '中央正式施工项目' })).toBeVisible()
      await page.getByRole('link', { name: '编辑分供方' }).click()
      await expect(page.getByRole('heading', { name: '编辑 · 分供方' })).toBeVisible({ timeout: 20_000 })
      await expect(page.getByLabel('公司全称')).toHaveValue(supplierName)
      const renamedSupplierName = `${supplierName}（已补档）`
      await page.getByLabel('公司全称').fill(renamedSupplierName)
      await page.getByLabel('主要联系人').fill('陈经理')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByRole('heading', { name: renamedSupplierName })).toBeVisible({ timeout: 20_000 })

      await page.goto(projectPath)
      const renamed = page.getByRole('region', { name: '项目分供方' }).getByRole('link', { name: renamedSupplierName })
      await expect(renamed).toBeVisible({ timeout: 20_000 })
      await renamed.click()
      await expect(page.getByRole('heading', { name: `中央正式施工项目 × ${renamedSupplierName}` })).toBeVisible({ timeout: 20_000 })
    })
  }

  test('真实零关系保留六类表头和空态，不把零记录误报为不存在', async ({ page }, testInfo) => {
    await reset(page.context().request, session(testInfo), 'zero')
    await page.goto('/project/project-real-317/supplier/supplier-real-317?tab=overview')
    await expect(page.getByRole('heading', { name: '中央正式项目 × 中央正式分供方' })).toBeVisible({ timeout: 20_000 })
    for (const [tab, empty, header] of [
      ['合同0', '暂无合同事实', '合同编号'],
      ['请款0', '暂无请款事实', '请款编号'],
      ['收票0', '暂无收票事实', '发票号码'],
      ['付款0', '暂无付款事实', '支付编号'],
      ['结算0', '暂无结算事实', '结算编号'],
    ] as const) {
      await page.getByRole('tab', { name: tab }).click()
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible()
      await expect(page.getByText(empty)).toBeVisible()
    }
    await expect(page.getByText('暂无来自合同、付款申请、支付或结算的附件')).toBeVisible()
  })

  test('不存在的父实体明确显示 not-found', async ({ page }) => {
    await page.goto('/project/proj_demo_002/supplier/supplier-missing?origin=demo&tab=overview')
    await expect(page.getByRole('status', { name: '未找到项目或分供方' })).toContainText('不存在或已删除')
  })

  test('关系错配、禁止与暂不可用明确分态', async ({ page }, testInfo) => {
    await page.goto('/project/proj_demo_001/supplier/sup_demo_004?origin=demo&tab=overview')
    await expect(page.getByRole('alert', { name: '项目与分供方关系不匹配' })).toBeVisible({ timeout: 20_000 })
    await reset(page.context().request, session(testInfo), 'forbidden')
    await page.goto(WORKBENCH)
    await expect(page.getByRole('status', { name: '无权查看项目分供方事实' })).toBeVisible()
    await reset(page.context().request, session(testInfo), 'unavailable')
    await page.goto(WORKBENCH)
    await expect(page.getByRole('alert', { name: '工作台加载失败' })).toContainText('暂时不可用')
  })

  test('工作台各宽度无页面级横滚，事实表仅自身横滚', async ({ page }) => {
    await page.goto(WORKBENCH)
    await expect(page.getByTestId('project-supplier-header')).toBeVisible({ timeout: 20_000 })
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expectNoPageOverflow(page, `#317 工作台 @ ${width}px`)
    }
    await page.getByRole('tab', { name: /^合同/ }).click()
    const table = page.getByLabel('业务记录表格，可横向滚动')
    await expect(table).toBeVisible()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await expect(table).toBeVisible()
      await expectNoPageOverflow(page, `#317 合同事实 @ ${width}px`)
    }
  })
})
