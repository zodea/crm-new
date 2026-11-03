import { Buffer } from 'node:buffer'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用独立正式合成目录验收班组导入，不连接用户数据库。')

test('班组重名与文件重复明确选择，替换保留未映射资料并在响应丢失后冷恢复', async ({ page }, info) => {
  test.setTimeout(180_000)
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY, requireIsolated: true })
  try {
    await fixture.start()
    await fixture.login()
    const envelope = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', requiredCapability: 'crew:write', baseVersion: null, action: 'draft', attachments: {} }
    const create = async (commandId: string, draft: object) => {
      const response = await fixture.request('/api/commands/crews', { method: 'POST', data: { ...envelope, commandId, draft } })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const first = await create('crew-import-first', { name: 'SYN Crew', trade: '泥工', defaultPayRatio: 0, rentSubsidyPrice: null, note: '原备注甲' })
    const second = await create('crew-import-second', { name: 'syn crew', trade: '木工', defaultPayRatio: 0.8, note: '原备注乙' })
    const input = { name: 'synthetic-crew.csv', mimeType: 'text/csv', buffer: Buffer.from('班组名称,备注\nSYN Crew,新备注\nSYN Crew,跳过备注', 'utf-8') }
    await page.goto(`${fixture.origin}/base/crew`)
    await page.getByRole('link', { name: '导入班组' }).click()
    await expect(page.getByRole('link', { name: '班组 Excel 参考模板' })).toBeVisible()
    await page.getByLabel('选择导入文件').setInputFiles(input)
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    const review = page.getByRole('region', { name: '班组重复资料核对' })
    await expect(review).toContainText('原备注甲')
    await expect(review).toContainText('原备注乙')
    await expect(review).toContainText('新备注')
    await expect(review.getByRole('option', { name: /替换 .*crew/i })).toHaveCount(4)
    await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${width}px 班组导入核对`)
    }
    await review.getByLabel('第 3 行处理方式').selectOption('skip')
    await review.getByLabel('第 2 行处理方式').selectOption(`replace:${first.id}`)
    let writes = 0
    await page.route('**/api/commands/crews/excel-import', async (route) => {
      writes++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('connectionreset')
    })
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交并重新预览' })).toBeVisible()
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain('新备注')
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/import/mapping/crew`)
    await page.getByLabel('选择导入文件').setInputFiles(input)
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '已核对上次导入：' })).toContainText('1 行已保存')
    expect(writes).toBe(1)
    const saved = await fixture.request(`/api/read/crews/${first.id}/form`)
    expect(saved.ok(), await saved.text()).toBe(true)
    expect(await saved.json()).toMatchObject({ draft: { id: first.id, note: '新备注', trade: '泥工', defaultPayRatio: 0, rentSubsidyPrice: null } })
    const untouched = await fixture.request(`/api/read/crews/${second.id}/form`)
    expect(untouched.ok(), await untouched.text()).toBe(true)
    expect(await untouched.json()).toMatchObject({ draft: { id: second.id, note: '原备注乙', trade: '木工', defaultPayRatio: 0.8 } })
  }
  finally { await fixture.cleanup() }
})
