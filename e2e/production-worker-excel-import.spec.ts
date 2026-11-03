import { Buffer } from 'node:buffer'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用独立正式合成目录及明确私密资料权限验收，不连接用户数据库。')

test('同名工人需明确选择，班组项目和原编号在响应丢失后可靠恢复', async ({ page }, info) => {
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY, requireIsolated: true })
  try {
    await fixture.start()
    await fixture.login()
    const envelope = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', baseVersion: null, action: 'draft', attachments: {} }
    const create = async (path: string, data: object) => {
      const response = await fixture.request(path, { method: 'POST', data })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const project = await create('/api/commands/projects', { ...envelope, requiredCapability: 'project:write', commandId: 'worker-import-project', draft: { name: '合成工人项目' } })
    const crew = await create('/api/commands/crews', { ...envelope, requiredCapability: 'crew:write', commandId: 'worker-import-crew', draft: { name: '合成工人班组' } })
    const worker = await create('/api/commands/workers', { ...envelope, requiredCapability: 'worker:write', commandId: 'worker-import-first', draft: { name: '合成同名人员', idCard: 'SYNTHETIC-ID-A', bankAccount: 'SYNTHETIC-BANK-A', note: '原备注' } })
    await create('/api/commands/workers', { ...envelope, requiredCapability: 'worker:write', commandId: 'worker-import-second', draft: { name: '合成同名人员', idCard: 'SYNTHETIC-ID-B', bankAccount: 'SYNTHETIC-BANK-B' } })
    await page.goto(`${fixture.origin}/base/worker`)
    await page.getByRole('link', { name: '导入工人' }).click()
    await expect(page.getByRole('link', { name: '工人 Excel 参考模板' })).toBeVisible()
    await page.getByLabel('选择导入文件').setInputFiles({ name: 'worker-synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('姓名,身份证号,所属班组,当前项目,备注\n合成同名人员,SYNTHETIC-ID-A,合成工人班组,合成工人项目,新备注', 'utf-8') })
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    const review = page.getByRole('region', { name: '工人资料与关联核对' })
    await expect(review).toContainText('原备注')
    await expect(review).toContainText('新备注')
    await expect(review.getByRole('option', { name: /替换 合成同名人员/ })).toHaveCount(2)
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${width}px 工人导入核对`)
    }
    await review.getByLabel('第 2 行处理方式').selectOption(`replace:${worker.id}`)
    await review.getByLabel('第 2 行所属班组').selectOption(crew.id)
    await review.getByLabel('第 2 行当前项目').selectOption(project.id)
    let writes = 0
    await page.route('**/api/commands/workers/excel-import', async (route) => {
      writes++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.abort('connectionreset')
    })
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交并重新预览' })).toBeVisible()
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }))
    expect(stored).not.toContain('SYNTHETIC-ID-A')
    expect(stored).not.toContain('SYNTHETIC-BANK-A')
    await page.getByRole('button', { name: '核对原提交并重新预览' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已核对上次导入：' })).toContainText('1 行已保存')
    expect(writes).toBe(1)
    const response = await fixture.request(`/api/read/workers/${worker.id}/form`)
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ draft: { id: worker.id, crewId: crew.id, currentProjectId: project.id, bankAccount: 'SYNTHETIC-BANK-A', note: '新备注' } })
  }
  finally { await fixture.cleanup() }
})
