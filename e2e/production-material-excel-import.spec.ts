import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { decodeContractOriginalContent } from '../app/lib/forms/original-content'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用独立正式合成目录验收采购合同整批原件与恢复，不连接用户数据库。')

test('填充参考模板并明确关联，整批响应丢失后重启核对原合同与原字节', async ({ page }, info) => {
  test.setTimeout(180_000)
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: process.env.CRM_E2E_SERVER_ENTRY, requireIsolated: true })
  try {
    await fixture.start()
    await fixture.login()
    const envelope = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner', baseVersion: null, action: 'save', attachments: {} }
    const create = async (path: string, data: object) => {
      const response = await fixture.request(path, { method: 'POST', data })
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const customer = await create('/api/commands/customers', { ...envelope, requiredCapability: 'customer:write', commandId: 'material-excel-customer', draft: { name: '合成采购客户', contact: '合成人' } })
    const project = await create('/api/commands/projects', { ...envelope, requiredCapability: 'project:write', commandId: 'material-excel-project', draft: { name: '合成采购项目', customerId: customer.id, manager: '合成人' } })
    const supplier = await create('/api/commands/suppliers', { ...envelope, requiredCapability: 'supplier:write', commandId: 'material-excel-supplier', draft: { name: '合成采购供方', supplierCategory: '其他', contact: '合成人' } })
    const signatory = await create('/api/commands/our-signatories', { workspaceId: envelope.workspaceId, actorId: envelope.actorId, requiredCapability: 'our-signatory:write', commandId: 'material-excel-signatory', baseVersion: null, draft: { name: '合成采购主体', taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '合成资料', status: 'active' } })
    const main = await create('/api/commands/construction-contracts', { ...envelope, requiredCapability: 'construction-contract:write', commandId: 'material-excel-main', draft: { name: '合成采购施工合同', projectId: project.id, customerId: customer.id, content: '合成工程', signDate: '2026-10-07', ourSignatoryId: signatory.id, ourSignatoryVersion: signatory.version, status: '已签订' } })
    const raw = await readFile('public/templates/material-contract-excel-template.xlsx')
    const workbook = XLSX.read(raw, { type: 'buffer' })
    XLSX.utils.sheet_add_aoa(workbook.Sheets.合同主档!, [
      ['G1', 'SYN-1', '合成采购一', '合成采购项目', '合成采购施工合同', '合成采购供方', '合成采购主体', null, 20],
      ['G2', 'SYN-2', '合成采购二', '合成采购项目', '合成采购施工合同', '合成采购供方', '合成采购主体', null, 40],
    ], { origin: 'A2' })
    XLSX.utils.sheet_add_aoa(workbook.Sheets.采购明细!, [
      ['G1', '合成方管', '', '', '', '米', '米', 2, 10, '', '是'],
      ['G2', '合成线管', '', '', '', '米', '米', 4, 10, '', '是'],
    ], { origin: 'A2' })
    const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
    const input = { name: '合成采购模板.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes }
    await page.goto(`${fixture.origin}/contract/material`)
    await page.getByRole('link', { name: '导入采购合同' }).click()
    await expect(page.getByRole('link', { name: '采购合同 Excel 参考模板' })).toBeVisible()
    await page.getByLabel('选择导入文件').setInputFiles(input)
    await page.getByRole('button', { name: '核对工作簿' }).click()
    const review = page.getByRole('region', { name: '采购合同核对' })
    await expect(review).toContainText('合成采购一')
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `${width}px 采购合同导入`)
    }
    for (const row of [2, 3]) {
      await review.getByLabel(`第 ${row} 行处理方式`).selectOption('create')
      await review.getByLabel(`第 ${row} 行项目`).selectOption(project.id)
      await review.getByLabel(`第 ${row} 行施工主合同`).selectOption(main.id)
      await review.getByLabel(`第 ${row} 行分供方`).selectOption(supplier.id)
      await review.getByLabel(`第 ${row} 行我方主体`).selectOption(signatory.id)
    }
    let writes = 0
    let ids: string[] = []
    await page.route('**/api/commands/material-contracts/excel-import', async (route) => {
      writes++
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      ids = (await response.json()).results.map((item: { id: string }) => item.id)
      await route.abort('connectionreset')
    })
    await page.getByRole('button', { name: '确认并保存整批合同' }).click()
    await expect(page.getByRole('button', { name: '核对原批次并重新预览' })).toBeVisible()
    const saved = await page.evaluate(() => JSON.stringify({ ...sessionStorage }))
    expect(saved).not.toContain('合成采购模板.xlsx')
    expect(saved).not.toContain('合成采购一')
    await fixture.stop()
    await fixture.start()
    await fixture.login()
    await page.goto(`${fixture.origin}/import/mapping/material-contract`)
    await page.getByLabel('选择导入文件').setInputFiles(input)
    await page.getByRole('button', { name: '核对工作簿' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已核对上次批次：' })).toContainText('2 份已保存')
    expect(writes).toBe(1)
    expect(ids).toHaveLength(2)
    for (const id of ids) {
      const response = await fixture.request(`/api/read/material-contracts/${id}/form`)
      expect(response.ok()).toBe(true)
      const form = await response.json()
      expect(form.draft).toMatchObject({ projectId: project.id, supplierId: supplier.id })
      expect(form.draft.lineItems).toHaveLength(1)
      expect(form.attachments).toHaveLength(1)
      const fileId = form.attachments[0].id
      const original = await fixture.request(`/api/read/material-contracts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}?origin=real`)
      expect(original.ok(), original.ok() ? '' : await original.text()).toBe(true)
      const content = await decodeContractOriginalContent(await original.json(), { ownerId: id, fileId, origin: 'real' }, () => {
        throw new Error('采购合同原件响应身份、长度或摘要无效')
      })
      expect(content.fileName).toBe(input.name)
      expect(content.fileSize).toBe(bytes.length)
      expect(Buffer.from(content.payloadBase64, 'base64').equals(bytes)).toBe(true)
    }
  }
  finally { await fixture.cleanup() }
})
