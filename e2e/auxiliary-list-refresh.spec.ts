import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'

for (const path of ['company-expense', 'other-expense', 'other-settlement']) {
  test(`${path} 同来源筛选和刷新保留表格，失败可重试，拒绝权限时清空`, async ({ page }, info) => {
    const session = Buffer.from(info.testId).toString('base64url')
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
    for (const domain of ['projects', 'suppliers', 'auxiliary-contracts', 'other-settlements']) {
      const response = await page.request.post(`/api/testing/${domain}/reset`, {
        headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session },
        data: { scenario: domain === 'other-settlements' ? 'related' : 'ready' },
      })
      expect(response.ok()).toBe(true)
    }
    await page.goto(`/contract/${path}`)
    const settlement = path === 'other-settlement'
    const list = page.getByTestId(settlement ? 'other-settlement-list' : 'auxiliary-list')
    const row = list.locator(`a[id^="${settlement ? 'other-settlement-' : 'aux-row-'}"]:visible`).first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.evaluate(element => element.setAttribute('data-retained-row', 'yes'))
    const endpoint = settlement ? 'other-settlements' : 'auxiliary-contracts'
    let mode: 'delay' | 'pass' | 'fail' | 'forbidden' = 'delay'
    let release!: () => void
    const gate = new Promise<void>(resolve => release = resolve)
    await page.route(`**/api/read/${endpoint}?**`, async (route) => {
      if (mode === 'delay')
        await gate
      if (mode === 'fail' || mode === 'forbidden') {
        await route.fulfill({ status: mode === 'fail' ? 503 : 403, json: { data: { code: mode === 'fail' ? 'unavailable' : 'forbidden', message: '读取暂不可用', retryable: mode === 'fail', fieldErrors: {}, traceId: null } } })
        return
      }
      await route.continue()
    })
    await list.getByRole('button', { name: '状态，已选 0 项', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('group', { name: '状态', exact: true }) })
    await dialog.getByRole('checkbox', { name: settlement ? '待确认' : '草稿', exact: true }).check()
    await dialog.getByRole('button', { name: '应用', exact: true }).click()
    await expect(list.locator('[aria-busy="true"]')).toBeVisible()
    await expect(list.locator('[data-retained-row="yes"]')).toBeVisible()
    await expect(list.getByText('正在更新列表…')).toBeVisible()
    await expect(list.locator('[data-ui="kit-table-loading"]:visible')).toHaveCount(0)
    mode = 'pass'
    release()
    await expect(list.locator('[aria-busy="true"]')).toHaveCount(0)

    mode = 'fail'
    await list.getByRole('button', { name: settlement ? '刷新结算列表' : '刷新合同列表', exact: true }).click()
    await expect(list.getByRole('alert')).toContainText('当前保留上一次成功读取的列表')
    await expect(row).toBeVisible()
    mode = 'forbidden'
    await list.getByRole('button', { name: '重试', exact: true }).click()
    await expect(row).toHaveCount(0)
    await expect(list.getByText('读取暂不可用', { exact: true })).toBeVisible()
  })
}
