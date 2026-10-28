import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// 过渡契约：正式导出由 #407/#406 承接，接入后改为正向验收。
test('中央分供方列表不把未接入的导出冒充可用', async ({ page }, info) => {
  const name = '中央导出边界材料供方'
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `supplier-export-${Buffer.from(info.testId).toString('base64url')}` })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const created = await page.request.post('/api/commands/suppliers', { data: {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    requiredCapability: 'supplier:write',
    commandId: randomUUID(),
    baseVersion: null,
    action: 'draft',
    draft: { name, supplierCategory: '材料供应商', contact: '合成联系人' },
    attachments: {},
  } })
  expect(created.ok(), await created.text()).toBe(true)
  await page.goto('/base/supplier')
  await page.getByRole('searchbox', { name: '搜索关键词…', exact: true }).fill(name)
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
  const toolbar = page.locator('[data-ui="supplier-list-toolbar"]')
  await expect(toolbar.getByRole('button', { name: '导出分供方台账', exact: true })).toHaveCount(0)
  await expect(toolbar.getByRole('button', { name: '分类导出分供方', exact: true })).toHaveCount(0)
  await expect(toolbar.getByRole('button', { name: '导入分供方', exact: true })).toBeEnabled()
})
