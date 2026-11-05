import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '仅在明确指定的独立测试层构建与合成数据库中运行')

for (const owner of ['project', 'company'] as const) {
  test(`拖放${owner === 'project' ? '项目' : '公司'}发票响应丢失后按原编号冷恢复`, async ({ page }, info) => {
    test.setTimeout(180_000)
    const entry = process.env.CRM_INVOICE_E2E_ENTRY
    if (!entry)
      throw new Error('必须指定包含发票工作台测试层的隔离构建入口。')
    const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmW0AAAAASUVORK5CYII=', 'base64')
    const expectedHash = createHash('sha256').update(image).digest('hex')
    let uploads = 0
    let submittedId = ''
    let submittedCommand = ''
    try {
      await page.route('**/local-ocr/runtime/paddleocr.js', route => route.abort())
      await fixture.start()
      await fixture.login()
      const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
      const projectResponse = await fixture.request('/api/commands/projects', { method: 'POST', data: { ...identity, requiredCapability: 'project:write', commandId: 'drag-project-create', baseVersion: null, action: 'draft', draft: { name: '合成拖放项目', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
      expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
      const project = await projectResponse.json() as { id: string }
      await page.goto(`${fixture.origin}/invoice-workspace-acceptance`)
      const area = page.getByRole('region', { name: '发票识别与核对' })
      if (owner === 'project')
        await page.getByLabel('上传项目').selectOption(project.id)
      else
        await page.getByLabel('上传归属').selectOption('company')
      await page.route('**/api/commands/invoices', async (route) => {
        const body = route.request().postDataJSON() as { action?: string, commandId?: string, projectId?: string | null, ownerKind?: string }
        if (body.action !== 'upload') {
          await route.continue()
          return
        }
        uploads++
        expect(body.projectId).toBe(owner === 'project' ? project.id : null)
        if (owner === 'company')
          expect(body.ownerKind).toBe('company')
        submittedCommand = body.commandId ?? ''
        const response = await route.fetch()
        expect(response.ok(), await response.text()).toBe(true)
        const result = await response.json() as { invoiceId: string }
        submittedId = result.invoiceId
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成响应丢失' }) })
      })
      async function drop() {
        await area.evaluate((target, base64) => {
          const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
          const transfer = new DataTransfer()
          transfer.items.add(new File([bytes], 'synthetic.png', { type: 'image/png' }))
          for (const type of ['dragenter', 'dragover', 'drop'])
            target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
        }, image.toString('base64'))
      }
      await drop()
      await expect(page.getByText('上次提交结果尚未核对，不能换编号重复提交。')).toBeVisible()
      expect(uploads).toBe(1)
      expect(submittedId).toBeTruthy()
      expect(submittedCommand).toBeTruthy()
      await drop()
      expect(uploads).toBe(1)
      await fixture.stop()
      await fixture.start()
      await fixture.login()
      await page.goto(`${fixture.origin}/invoice-workspace-acceptance`)
      await expect(page.getByRole('button', { name: '核对上次提交' })).toBeVisible()
      await page.getByRole('button', { name: '核对上次提交' }).click()
      await expect(page.getByRole('button', { name: '核对上次提交' })).toHaveCount(0)
      expect(uploads).toBe(1)
      const response = await fixture.request(`/api/read/invoices/${encodeURIComponent(submittedId)}`)
      expect(response.ok(), await response.text()).toBe(true)
      const read = await response.json() as { record: { id: string, sourceKind: string, ownerKind: string, projectId: string | null, original: { id: string, sha256: string } } }
      expect(read.record).toMatchObject({ id: submittedId, sourceKind: 'scan', ownerKind: owner, projectId: owner === 'project' ? project.id : null, original: { sha256: expectedHash } })
      const original = await fixture.request(`/api/read/invoices/${encodeURIComponent(submittedId)}/originals/${encodeURIComponent(read.record.original.id)}`)
      expect(original.ok(), await original.text()).toBe(true)
      expect(await original.body()).toEqual(image)
    }
    finally {
      await fixture.cleanup()
    }
  })
}
