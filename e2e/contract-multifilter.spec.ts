import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

for (const domain of ['material', 'construction', 'subcontract'] as const) {
  test(`${domain} 合同固定多选贯通中央查询，刷新保留表格与四档滚动边界`, async ({ page }, testInfo) => {
    const session = Buffer.from(testInfo.testId).toString('base64url')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    const reset = await page.context().request.post(`/api/testing/${domain}-contracts/reset`, {
      headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session },
      data: { scenario: 'ready' },
    })
    expect(reset.ok()).toBe(true)
    await page.goto(`/contract/${domain}`)
    const list = page.getByTestId(`${domain}-contract-list`)
    const row = list.locator(`a[id^="${domain}-contract-row-"]:visible`).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.evaluate(element => element.setAttribute('data-refresh-snapshot', 'retained'))

    let release!: () => void
    const gate = new Promise<void>(resolve => release = resolve)
    let pending = false
    await page.route(`**/api/read/${domain}-contracts?**`, async (route) => {
      if (!pending && new URL(route.request().url()).searchParams.get('status')?.startsWith('[')) {
        pending = true
        await gate
      }
      await route.continue()
    })
    await list.getByRole('button', { name: '筛选状态，已选 0 项' }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: '状态', exact: true }) })
    for (const status of ['草稿', '审批中', '履约中', '已签订', '已结算', '已结清'])
      await expect(dialog.getByRole('checkbox', { name: status, exact: true })).toBeVisible()
    await dialog.getByRole('checkbox', { name: '草稿', exact: true }).check()
    await dialog.getByRole('checkbox', { name: '履约中', exact: true }).check()
    const response = page.waitForResponse(item => item.url().includes(`/api/read/${domain}-contracts?`) && new URL(item.url()).searchParams.get('status')?.startsWith('[') === true)
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect.poll(() => pending).toBe(true)
    await expect(list.locator('[aria-busy="true"]')).toBeVisible()
    await expect(list.getByText('正在更新列表…')).toBeVisible()
    await expect(list.locator('[data-refresh-snapshot="retained"]')).toBeVisible()
    await expect(list.locator('[data-ui="kit-table-loading"]:visible')).toHaveCount(0)
    release()
    const loaded = await response
    expect(loaded.ok()).toBe(true)
    const result = await loaded.json()
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item: { status: string }) => ['草稿', '履约中'].includes(item.status))).toBe(true)
    await expect(list.locator('[aria-busy="true"]')).toHaveCount(0)
    expect(JSON.parse(new URL(page.url()).searchParams.get('status')!)).toEqual(['草稿', '履约中'])

    if (domain === 'subcontract') {
      await list.getByRole('button', { name: '筛选分包类别，已选 0 项' }).click()
      const kinds = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: '分包类别', exact: true }) })
      await kinds.getByRole('checkbox', { name: '劳务', exact: true }).check()
      await kinds.getByRole('checkbox', { name: '专业', exact: true }).check()
      await kinds.getByRole('button', { name: '应用', exact: true }).click()
      await expect(list.getByRole('button', { name: '筛选分包类别，已选 2 项' })).toBeVisible()
    }

    const headerLabel = domain === 'subcontract' ? '分包类别' : domain === 'material' ? '合同状态' : '状态'
    const header = list.getByRole('button', { name: `筛选${headerLabel}`, exact: true })
    await header.click()
    const headerDialog = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: `${headerLabel}筛选值`, exact: true }) })
    for (const value of domain === 'subcontract' ? ['劳务', '专业'] : ['草稿', '履约中'])
      await expect(headerDialog.getByRole('checkbox', { name: value, exact: true })).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(header).toBeFocused()

    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${domain} ${width}px`)
      const trigger = list.getByRole('button', { name: '筛选状态，已选 2 项' })
      await trigger.click()
      await expect(dialog).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    }
    await page.reload()
    await expect(list.getByRole('button', { name: '筛选状态，已选 2 项' })).toBeVisible()
    await expect(row).toBeVisible()
    const target = new URL(await row.getAttribute('href') ?? '', page.url())
    const returnTo = new URL(target.searchParams.get('returnTo')!, page.url())
    expect(JSON.parse(returnTo.searchParams.get('status')!)).toEqual(['草稿', '履约中'])
    if (domain === 'subcontract')
      expect(JSON.parse(returnTo.searchParams.get('subKind')!)).toEqual(['劳务', '专业'])
  })
}
