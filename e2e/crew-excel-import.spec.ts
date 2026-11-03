import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test('班组导入先核对同名资料和文件内重复，替换保留未映射比例', async ({ page }, info) => {
  const session = `crew-excel-${Buffer.from(info.testId).toString('base64url')}`
  const headers = { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session }
  const reset = () => page.request.post('/api/testing/crew-workers/reset', { headers, data: { scenario: 'ready' } })
  expect((await reset()).ok()).toBe(true)
  await page.setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
  try {
    const created = await page.request.post('/api/commands/crews', { data: { workspaceId: 'workspace-default', actorId: 'actor-default', requiredCapability: 'crew:write', commandId: 'crew-excel-seed', baseVersion: null, action: 'save', attachments: {}, draft: { name: '合成已有班组', trade: '泥工', contactName: '合成负责人', contactPhone: '13800000001', defaultPayRatio: 0.8, note: '原备注' } } })
    expect(created.ok()).toBe(true)
    const id = (await created.json()).id as string
    await page.goto('/base/crew')
    await page.getByRole('link', { name: '导入班组' }).click()
    await expect(page.getByRole('link', { name: '班组 Excel 参考模板' })).toBeVisible()
    expect((await page.request.get('/templates/crew-excel-template.xlsx')).ok()).toBe(true)
    await page.getByLabel('选择导入文件').setInputFiles({ name: 'synthetic-crew.csv', mimeType: 'text/csv', buffer: Buffer.from('班组名称,备注\n合成已有班组,新备注\n合成重复班组,甲\n合成重复班组,乙', 'utf-8') })
    await page.getByRole('button', { name: '下一步', exact: true }).click()
    const review = page.getByRole('region', { name: '班组重复资料核对' })
    await expect(review).toContainText('原备注')
    await expect(review).toContainText('新备注')
    await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled()
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${width}px 班组导入预览`)
    }
    await review.getByLabel('第 2 行处理方式').selectOption(`replace:${id}`)
    await review.getByLabel('第 4 行处理方式').selectOption('skip')
    await expect(page.getByRole('button', { name: '开始导入', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '开始导入', exact: true }).click()
    await expect(page).toHaveURL(/\/base\/crew/)
    const response = await page.request.get(`/api/read/crews/${id}/form`)
    expect(response.ok()).toBe(true)
    expect(await response.json()).toMatchObject({ draft: { note: '新备注', defaultPayRatio: 0.8, trade: '泥工' } })
  }
  finally { await reset() }
})
