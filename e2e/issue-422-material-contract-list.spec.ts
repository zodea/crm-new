import type { MaterialContractListPageDTO } from '../app/lib/material-contract/read-contract'
import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { createVerifiedSignatory, selectVerifiedSignatory } from './helpers/contract-signatory'
import { expectLocalHorizontalScroll, expectNoPageOverflow } from './helpers/responsive'

const money = (value: number | string | null) => value === null ? '待核实' : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

test.describe('Issue #422 材料采购合同列表', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const session = Buffer.from(testInfo.testId).toString('base64url')
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    const reset = await page.context().request.post('/api/testing/material-contracts/reset', {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session },
      data: { scenario: 'ready' },
    })
    expect(reset.ok()).toBe(true)
  })

  test('分页、中文搜索、来源隔离与详情返回消费同一完整结果', async ({ page }, testInfo) => {
    const request = page.context().request
    const allResponse = await request.get('/api/read/material-contracts?includeDemo=true&pageSize=100', {
      headers: { 'x-ruihang-test-session': Buffer.from(testInfo.testId).toString('base64url') },
    })
    expect(allResponse.ok()).toBe(true)
    const all: MaterialContractListPageDTO = await allResponse.json()
    expect(all.items.length).toBeGreaterThan(10)
    for (const origin of ['real', 'demo'] as const) {
      const rows = all.items.filter(row => row.dataOrigin === origin)
      expect(all.summary.origins[origin].contractCount).toBe(rows.length)
      for (const [field, summaryField] of [['changed', 'changedAmount'], ['invoiced', 'invoicedAmount'], ['paid', 'paidAmount']] as const)
        expect(Number(all.summary.origins[origin][summaryField])).toBeCloseTo(rows.reduce((sum, row) => sum + Number(row.amounts[field]), 0), 2)
    }
    await page.goto('/contract/material?pageSize=10&page=2')
    const list = page.getByTestId('material-contract-list')
    const summary = list.getByRole('status', { name: '列表汇总' })
    await expect(summary).toBeVisible({ timeout: 20_000 })
    await expect(summary).toContainText(`正式 · ${all.summary.origins.real.contractCount} 份`)
    await expect(summary).toContainText(money(all.summary.origins.demo.changedAmount))
    const original = await summary.textContent()
    await list.getByLabel('每页数量', { exact: true }).selectOption('20')
    await expect(page).not.toHaveURL(/[?&]page=2/)
    await expect(summary).toHaveText(original!)

    const search = list.getByRole('searchbox', { name: '搜索材料采购合同' })
    await search.fill('瓷')
    await search.fill('瓷砖')
    await expect(summary).toContainText('演示 · 1 份')
    await expect(search).toBeFocused()
    await list.getByLabel('筛选项目', { exact: true }).selectOption('proj_demo_001')
    await list.getByRole('button', { name: '筛选状态，已选 0 项' }).click()
    const statuses = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: '状态', exact: true }) })
    await statuses.getByRole('checkbox', { name: '履约中', exact: true }).check()
    await statuses.getByRole('checkbox', { name: '已签订', exact: true }).check()
    await statuses.getByRole('button', { name: '应用', exact: true }).click()
    await expect(list.getByRole('button', { name: '筛选状态，已选 2 项' })).toBeVisible()
    await expect(summary).toContainText('演示 · 1 份')
    const detailLink = list.locator('a[id^="material-contract-row-"]:visible').first()
    await expect(detailLink).toHaveText('瓷砖采购合同')
    const expected = all.items.find(row => row.id === 'con_demo_cg01')!
    for (const amount of Object.values(expected.amounts))
      await expect(list.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')).toContainText(money(amount))
    const detailRead = page.waitForResponse(response => response.url().includes('/api/read/material-contracts/con_demo_cg01?'))
    await detailLink.click()
    await expect(page.getByTestId('material-contract-detail')).toBeVisible()
    const detail = await (await detailRead).json()
    expect(detail.contract.amounts).toEqual(expected.amounts)
    for (const amount of Object.values(expected.amounts))
      await expect(page.getByTestId('material-contract-detail')).toContainText(money(amount))
    await page.getByRole('link', { name: '返回材料采购合同列表' }).click()
    await expect(search).toHaveValue('瓷砖')
    await expect(list.getByLabel('筛选项目', { exact: true })).toHaveValue('proj_demo_001')
    await expect(list.getByRole('button', { name: '筛选状态，已选 2 项' })).toBeVisible()
    await expect(detailLink).toBeFocused()
    await expect(summary).toContainText('演示 · 1 份')
    await expect(summary).not.toContainText('正式 ·')
    await search.fill('不存在的合成编号422')
    await expect(summary).toContainText('演示 · 0 份')
    await expect(summary).toContainText('¥0.00')
    await search.fill('')
    await list.getByLabel('筛选项目', { exact: true }).selectOption('')
    await list.getByRole('button', { name: '筛选状态，已选 2 项' }).click()
    await statuses.getByRole('button', { name: '清空', exact: true }).click()
    await statuses.getByRole('button', { name: '应用', exact: true }).click()
    await expect(summary).toContainText(`演示 · ${all.summary.origins.demo.contractCount} 份`)
    await page.goto('/contract/material?origin=real')
    await expect(summary).toContainText(`正式 · ${all.summary.origins.real.contractCount} 份`)
    await expect(summary).not.toContainText('演示 ·')
  })

  test('刷新失败保留已读金额，重试更新，失去权限清空汇总和关系入口', async ({ page }, testInfo) => {
    await page.goto('/contract/material')
    const list = page.getByTestId('material-contract-list')
    const summary = list.getByRole('status', { name: '列表汇总' })
    await expect(summary).toBeVisible({ timeout: 20_000 })
    const original = await summary.textContent()
    const reset = async (scenario: string) => {
      const response = await page.context().request.post('/api/testing/material-contracts/reset', {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': Buffer.from(testInfo.testId).toString('base64url') },
        data: { scenario },
      })
      expect(response.ok()).toBe(true)
    }
    await reset('unavailable')
    await list.getByLabel('搜索材料采购合同').fill('瓷砖')
    await expect(list.getByRole('alert')).toContainText('当前保留上一次成功读取的列表')
    await expect(summary).toHaveText(original!)
    await reset('ready')
    await list.getByRole('button', { name: '重试', exact: true }).click()
    await expect(summary).toContainText('演示 · 1 份')
    await reset('forbidden')
    await list.getByLabel('搜索材料采购合同').fill('权限撤回')
    await expect(list.getByText('无权查看材料采购合同')).toBeVisible()
    await expect(summary).toHaveCount(0)
    await expect(list.locator('a[id^="material-contract-row-"]')).toHaveCount(0)
  })

  test('真实命令保存长名称，五档视口局部横滚、关系入口及筛选焦点可用', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const longName = '合成材料采购合同－长名称与零金额验收－外墙铝板及机电安装辅材联合采购标段'
    const largeAmount = '123456789012.34'
    const signatoryName = 'E2E材采长名称已核实我方主体'
    const signatoryId = await createVerifiedSignatory(page, signatoryName)
    await page.goto('/contract/material/form/contract-existing-318')
    await selectVerifiedSignatory(page, signatoryId, signatoryName)
    await page.getByLabel('合同名称 *').fill(longName)
    await page.getByLabel('含税合同金额 *', { exact: true }).fill(largeAmount)
    const saved = page.waitForResponse(response => response.url().includes('/api/commands/material-contracts/') && response.request().method() === 'PUT')
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    expect((await saved).ok()).toBe(true)
    await page.goto('/contract/material?search=合成材料采购合同&origin=real')
    const list = page.getByTestId('material-contract-list')
    const name = list.locator('a[id^="material-contract-row-"]:visible').first()
    await expect(name).toHaveText(longName)
    await page.reload()
    await expect(name).toHaveAttribute('title', longName)
    await expect(list.getByRole('status', { name: '列表汇总' })).toContainText(money(largeAmount))
    await expect(list.getByRole('link', { name: '中央正式材料项目' })).toHaveAttribute('href', '/project/project-real-318?origin=real')
    await expect(list.getByRole('link', { name: '中央正式材料供应商' })).toHaveAttribute('href', '/base/supplier/supplier-real-318?origin=real')
    for (const width of [390, 768, 1024, 1293, 1440]) {
      await page.setViewportSize({ width, height: width === 1293 ? 1051 : 900 })
      await expectNoPageOverflow(page, `#422 @ ${width}`)
      const scroll = list.locator('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')
      await expectLocalHorizontalScroll(scroll, `#422 @ ${width}`)
      const fixed = list.locator('.vxe-table--fixed-left-wrapper')
      const box = await fixed.boundingBox()
      expect(box!.width).toBeLessThan(width - 60)
      const filter = list.getByRole('button', { name: '筛选状态，已选 0 项' })
      await filter.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: '状态', exact: true }) })
      await expect(dialog).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(filter).toBeFocused()
      await page.screenshot({ path: testInfo.outputPath(`material-contract-list-${width}.png`), fullPage: true })
      await scroll.evaluate(element => element.scrollLeft = element.scrollWidth)
      await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
      await expect(name).toBeInViewport()
      await expect(list.getByRole('button', { name: '筛选合同状态', exact: true })).toBeInViewport()
      await page.screenshot({ path: testInfo.outputPath(`material-contract-list-${width}-scrolled.png`), fullPage: true })
      await scroll.evaluate(element => element.scrollLeft = 0)
    }
    await name.click()
    await expect(page.getByRole('heading', { name: longName })).toBeVisible()
    await expect(page.getByTestId('material-contract-detail')).toContainText(money(largeAmount))
    await expect(page.getByTestId('material-contract-detail')).toContainText('¥0.00')
  })
})
