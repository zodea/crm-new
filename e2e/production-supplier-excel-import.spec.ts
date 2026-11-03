import { Buffer } from 'node:buffer'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用独立正式合成目录及敏感资料权限验收分供方导入，不连接用户数据库。')

test('分供方重名与文件重复明确选择，替换保留未映射资料并在响应丢失后冷恢复', async ({ page }, info) => {
  test.setTimeout(180_000)
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY, requireIsolated: true })
  try {
    await fixture.start()
    await fixture.login()
    const envelope = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', requiredCapability: 'supplier:write', baseVersion: null, action: 'draft', attachments: {} }
    const create = async (commandId: string, draft: object) => {
      const response = await fixture.request('/api/commands/suppliers', { method: 'POST', data: { ...envelope, commandId, draft } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const first = await create('supplier-import-first', { name: '合成同名供方', supplierCategory: '其他', contact: '原联系人甲', externalRef: 'SYN-EXT-A', uniqueCode: 'SYN-CODE-A', bankAccount: 'SYN-BANK-A', note: '' })
    const second = await create('supplier-import-second', { name: '合成同名供方', supplierCategory: '其他', contact: '原联系人乙', externalRef: 'SYN-EXT-B', uniqueCode: 'SYN-CODE-B', bankAccount: 'SYN-BANK-B' })
    const input = { name: 'synthetic-supplier.csv', mimeType: 'text/csv', buffer: Buffer.from('公司全称,主要联系人\n合成同名供方,新联系人\n合成同名供方,跳过联系人', 'utf-8') }
    await page.goto(`${fixture.origin}/base/supplier`)
    await page.getByRole('button', { name: '导入分供方', exact: true }).click()
    await page.getByLabel('选择导入文件').setInputFiles(input)
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    const review = page.getByRole('region', { name: '分供方重复资料核对' })
    await expect(review).toContainText('原联系人甲')
    await expect(review).toContainText('原联系人乙')
    await expect(review).toContainText('新联系人')
    await expect(review.getByRole('option', { name: /替换 合成同名供方/ })).toHaveCount(4)
    await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${width}px 分供方导入核对`)
    }
    await review.getByLabel('第 3 行处理方式').selectOption('skip')
    await review.getByLabel('第 2 行处理方式').selectOption(`replace:${first.id}`)
    let writes = 0
    await page.route('**/api/commands/suppliers/import', async (route) => {
      writes++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('connectionreset')
    })
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交并重新预览' })).toBeVisible()
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }))
    expect(stored).not.toContain('新联系人')
    expect(stored).not.toContain('SYN-BANK-A')
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/import/mapping/supplier`)
    await page.getByLabel('选择导入文件').setInputFiles(input)
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已核对上次导入：' })).toContainText('1 行已保存')
    expect(writes).toBe(1)
    const saved = await fixture.request(`/api/read/suppliers/${first.id}/form`)
    expect(saved.ok(), await saved.text()).toBe(true)
    expect(await saved.json()).toMatchObject({ draft: { id: first.id, contact: '新联系人', externalRef: 'SYN-EXT-A', uniqueCode: 'SYN-CODE-A', bankAccount: 'SYN-BANK-A', note: '' } })
    const untouched = await fixture.request(`/api/read/suppliers/${second.id}/form`)
    expect(untouched.ok(), await untouched.text()).toBe(true)
    expect(await untouched.json()).toMatchObject({ draft: { id: second.id, contact: '原联系人乙', externalRef: 'SYN-EXT-B', uniqueCode: 'SYN-CODE-B', bankAccount: 'SYN-BANK-B' } })
  }
  finally { await fixture.cleanup() }
})
