import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// 正式导出仍由 #407/#406 承接；真实 XLSX 内容和分类目录保留在
// tests/supplier/export.test.ts，下载及目录写入保留在 KitUI 导出验收。
for (const input of [
  { label: '材料供应商', name: '中央导出边界材料供方' },
  { label: '劳务分包商', name: '中央导出边界劳务供方' },
]) {
  for (const width of [390, 768, 1024, 1280, 1440]) {
    test(`${input.label} @ ${width}px 中央列表不把未接入的导出冒充可用`, async ({ page }, info) => {
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
        draft: { name: input.name, supplierCategory: input.label, contact: '合成联系人' },
        attachments: {},
      } })
      expect(created.ok(), await created.text()).toBe(true)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      await page.goto('/base/supplier')
      await page.getByRole('searchbox', { name: '搜索关键词…', exact: true }).fill(input.name)
      await expect(page.getByRole('link', { name: input.name, exact: true })).toBeVisible()
      const toolbar = page.locator('[data-ui="supplier-list-toolbar"]')
      await expect(toolbar.getByRole('button', { name: '导出分供方台账', exact: true })).toHaveCount(0)
      await expect(toolbar.getByRole('button', { name: '分类导出分供方', exact: true })).toHaveCount(0)
      await expect(toolbar.getByRole('button', { name: '导入分供方', exact: true })).toBeEnabled()
    })
  }
}
