import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'
import { expectNoPageOverflow } from './helpers/responsive'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '使用全新正式构建与隔离合成数据库，不连接用户数据库')

for (const outcome of ['unknown', 'known-read-failed'] as const) {
  test(`正式往来整页 ${outcome} 保原编号、原件与后来输入，五档核对及冷开启读取真实付款详情`, async ({ page }, info) => {
    test.setTimeout(180000)
    const f = await createCrewWorkerProductionFixture(page, info)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await f.start()
      await f.login()
      const context = await (await f.request('/api/read/finance/current/context')).json()
      const identity = { workspaceId: context.workspaceId, actorId: context.actorId }
      async function command(path: string, capability: string, commandId: string, draft: object, extra: object = {}) {
        const response = await f.request(`/api/commands/${path}`, { method: 'POST', data: { ...identity, requiredCapability: capability, commandId, baseVersion: null, action: 'draft', attachments: {}, draft, ...extra } })
        expect(response.ok(), await response.text()).toBe(true)
        return response.json()
      }
      const supplier = await command('suppliers', 'supplier:write', 'finance-browser-supplier', { name: '实际个人临时金分供方', supplierCategory: '其他', contact: '合成人' })
      const project = await command('projects', 'project:write', 'finance-browser-project', { name: '实际资金项目' })
      const seed = await command('finance', 'finance-current:write', 'finance-browser-current', { projectId: project.id, supplierId: supplier.id, direction: 'payment', amount: 0, transactionDate: '2026-10-05' }, { kind: 'current' })
      await page.goto(`${f.origin}/finance/current/${seed.id}?origin=real`)
      const amount = page.getByTestId('finance-amount')
      const save = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true })
      await expect(amount).toHaveValue('0')
      await expect(save).toBeDisabled()
      await amount.fill('10')
      await page.getByTestId('finance-attachment-input').setInputFiles({ name: '实际原件.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 10, 128, 255]) })
      await expect(page.getByText('实际原件.bin', { exact: true })).toBeVisible()
      await expect(save).toBeEnabled()
      let posts = 0
      let resolves = 0
      let originalCommand = ''
      let written!: () => void
      let release!: () => void
      const persisted = new Promise<void>(resolve => written = resolve)
      const held = new Promise<void>(resolve => release = resolve)
      let refuseRead = false
      await page.route('**/api/commands/finance/resolve', async (route) => {
        resolves++
        expect(route.request().postDataJSON().commandId).toBe(originalCommand)
        await route.continue()
      })
      await page.route(`**/api/read/finance/current/form/${seed.id}`, async (route) => {
        if (refuseRead)
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成已保存后读取失败' }) })
        else
          await route.continue()
      })
      await page.route('**/api/commands/finance', async (route) => {
        posts++
        originalCommand = route.request().postDataJSON().commandId
        const response = await route.fetch()
        expect(response.ok(), await response.text()).toBe(true)
        written()
        await held
        if (outcome === 'unknown') {
          await route.abort('failed')
        }
        else {
          refuseRead = true
          await route.fulfill({ response })
        }
      })
      await save.click()
      await persisted
      await expect(save).toBeDisabled()
      await amount.fill('12')
      await page.getByTestId('finance-attachment-input').setInputFiles({ name: '尚未提交的后来原件.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]) })
      await expect(page.getByText('尚未提交的后来原件.bin', { exact: true })).toBeVisible()
      release()
      let recover = page.getByRole('button', { name: outcome === 'unknown' ? '核对原提交' : '只重试读取', exact: true })
      await expect(recover).toBeVisible()
      await expect(amount).toHaveValue('12')
      const descriptors = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('crm:form-command:v1:finance-current:')).map(([key, value]) => ({ key, descriptor: JSON.parse(value) })))
      expect(descriptors).toHaveLength(1)
      expect(descriptors[0]!.descriptor).toEqual({ commandId: originalCommand, workspaceId: identity.workspaceId, actorId: identity.actorId, family: 'finance-current', targetId: seed.id, action: 'draft' })
      expect(JSON.stringify(descriptors)).not.toContain('尚未提交的后来原件')
      if (outcome === 'unknown') {
        refuseRead = true
        await f.stop()
        await f.start()
        await f.login()
        await page.goto(`${f.origin}/finance/current/${seed.id}?origin=real`)
        recover = page.getByRole('button', { name: '核对原提交', exact: true })
        await expect(recover).toBeVisible()
      }
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page, `财务原提交核对 ${outcome} ${width}px`)
        await recover.scrollIntoViewIfNeeded()
        await recover.focus()
        await expect(recover).toBeFocused()
        await expect(recover).toBeInViewport()
      }
      refuseRead = false
      await page.keyboard.press('Enter')
      await expect(recover).toHaveCount(0)
      expect(posts).toBe(1)
      expect(resolves).toBe(outcome === 'unknown' ? 1 : 0)
      if (outcome === 'known-read-failed') {
        await expect(amount).toHaveValue('12')
        await expect(page.getByText('尚未提交的后来原件.bin', { exact: true })).toBeVisible()
      }
      await expect(page.getByText('实际原件.bin', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('crm:form-command:v1:finance-current:')))).toEqual([])
      const current = await (await f.request(`/api/read/finance/current/form/${seed.id}`)).json()
      expect(current).toMatchObject({ version: '2', draft: { amount: 10, supplierId: supplier.id, projectId: project.id } })
      expect(current.attachments).toHaveLength(1)
      expect(current.attachments[0]).toMatchObject({ fileName: '实际原件.bin', fileSize: 4 })
      const original = await f.request(`/api/read/finance/current/files/${seed.id}/${current.attachments[0].id}`)
      expect(new Uint8Array(await original.body())).toEqual(new Uint8Array([0, 10, 128, 255]))
      await page.unroute('**/api/commands/finance')
      await page.unroute('**/api/commands/finance/resolve')
      await page.unroute(`**/api/read/finance/current/form/${seed.id}`)
      let listReadFails = true
      await page.route('**/api/read/finance/current/list', async (route) => {
        if (listReadFails)
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成当前列表读取失败' }) })
        else
          await route.continue()
      })
      await page.goto(`${f.origin}/finance/current?origin=real`)
      await expect(page.getByTestId('finance-list-unavailable')).toBeVisible()
      await expect(page.getByTestId('finance-list-summary-unknown')).toHaveText('金额合计尚未核实')
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page, `正式财务列表未知 ${outcome} ${width}px`)
        const retry = page.getByTestId('finance-list-unavailable').getByRole('button', { name: '重新读取', exact: true })
        await retry.focus()
        await expect(retry).toBeFocused()
      }
      listReadFails = false
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('finance-list-unavailable')).toHaveCount(0)
      await expect(page.getByTestId('finance-list-summary-unknown')).toHaveCount(0)
      await expect(page.getByText('¥10.00', { exact: true }).first()).toBeVisible()
      await page.unroute('**/api/read/finance/current/list')
      const application = await command('finance', 'finance-payment-application:write', 'finance-browser-application', { name: '正式真实付款详情', status: 'approved', bizType: '公司付款', supplierId: supplier.id, applyAmount: 100, approvedAmount: outcome === 'unknown' ? null : 0, applyDate: '2026-10-05', applicant: '合成财务', invoiceState: '无需发票' }, { kind: 'payment_application', action: 'save' })
      await f.stop()
      await f.start()
      await f.login()
      for (const operation of ['context', 'list', `form/${application.id}`]) {
        const response = await f.request(`/api/read/finance/payment_application/${operation}`)
        expect(response.ok(), await response.text()).toBe(true)
        expect(response.headers()['content-type']).toContain('application/json')
        const read = await response.json()
        expect(read).toMatchObject({ ...identity, dataOrigin: 'real', scope: { kind: 'payment_application', operation: operation.split('/')[0] }, meta: { schemaVersion: 'finance-read-v1', ...identity } })
        if (operation === 'list')
          expect(read.items).toEqual([expect.objectContaining({ id: application.id, amount: '100' })])
        if (operation.startsWith('form/'))
          expect(read).toMatchObject({ scope: { id: application.id }, version: '1', draft: { id: application.id, applyAmount: 100 } })
      }
      const detail = await (await f.request(`/api/read/finance/payment_application/detail/${application.id}`)).json()
      await info.attach('production-finance-detail-response', { body: JSON.stringify(detail), contentType: 'application/json' })
      await page.goto(`${f.origin}/finance/payment/${application.id}/detail?origin=real`)
      await expect(page.getByText('正式真实付款详情', { exact: true }).first()).toBeVisible()
      await expect(page.getByTestId('payment-application-insight')).toBeVisible()
      await expect(page.getByText('跨项目/分供方付款', { exact: true })).toBeVisible()
      expect(detail.detail).toMatchObject({ applyAmount: '100', approvedAmount: outcome === 'unknown' ? null : '0', paidAmount: '0', unpaidAmount: outcome === 'unknown' ? '100' : '0', supplierId: supplier.id, workerId: null, invoiceState: '无需发票', invoiceDifference: '100', pendingInvoiceAmount: '0' })
      await expect(page.getByRole('group', { name: '待回票', exact: true })).toHaveCount(0)
      await expect(page.getByText('本申请无需发票。', { exact: true })).toBeVisible()
      if (outcome === 'known-read-failed')
        await expect(page.getByTestId('payment-application-create-payment')).toHaveCount(0)
      else
        await expect(page.getByTestId('payment-application-create-payment')).toBeVisible()
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page, `正式付款详情 ${outcome} ${width}px`)
        await page.getByTestId('payment-application-edit').focus()
        await expect(page.getByTestId('payment-application-edit')).toBeFocused()
      }
      for (const [invoiceState, applyAmount, key] of [['先票后款', 100, 'before'], ['先款后票', 0, 'zero']] as const) {
        const invoiceApplication = await command('finance', 'finance-payment-application:write', `finance-browser-invoice-${key}`, { name: `回票类型验证-${key}`, bizType: '公司付款', supplierId: supplier.id, applyAmount, approvedAmount: null, invoiceState }, { kind: 'payment_application', action: 'draft' })
        const invoiceRead = await (await f.request(`/api/read/finance/payment_application/detail/${invoiceApplication.id}`)).json()
        expect(invoiceRead.detail).toMatchObject({ invoiceState, applyAmount: String(applyAmount), invoiceDifference: String(applyAmount), pendingInvoiceAmount: '0', paidAmount: '0', approvedAmount: null })
        await page.goto(`${f.origin}/finance/payment/${invoiceApplication.id}/detail?origin=real`)
        await expect(page.getByText(`回票类型验证-${key}`, { exact: true }).first()).toBeVisible()
        if (invoiceState === '先款后票')
          await expect(page.getByRole('group', { name: '待回票', exact: true })).toContainText('¥0.00')
        else
          await expect(page.getByRole('group', { name: '待回票', exact: true })).toHaveCount(0)
        for (const width of [390, 768, 1024, 1280, 1440]) {
          await page.setViewportSize({ width, height: 900 })
          await expectNoPageOverflow(page, `对应回票义务 ${invoiceState} ${outcome} ${width}px`)
          await page.getByTestId('payment-application-edit').focus()
          await expect(page.getByTestId('payment-application-edit')).toBeFocused()
        }
      }
      await page.goto(`${f.origin}/finance/payment-management?origin=real`)
      await expect(page.getByRole('group', { name: '已支付', exact: true })).toContainText('¥0.00')
      if (outcome === 'known-read-failed') {
        await page.getByRole('button', { name: '付款状态，已选 1 项' }).click()
        await page.getByRole('button', { name: '清除', exact: true }).click()
      }
      await expect(page.getByText('正式真实付款详情', { exact: true })).toBeVisible()
      let managementReadFailed = true
      await page.route('**/api/read/finance/payment_application/list', async (route) => {
        if (managementReadFailed)
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '实际付款管理读取失败' }) })
        else
          await route.continue()
      })
      await page.getByRole('button', { name: '刷新付款管理', exact: true }).click()
      await expect(page.getByTestId('payment-management-summary-unknown')).toBeVisible()
      await expect(page.getByText('正式真实付款详情', { exact: true })).toHaveCount(0)
      const managementRetry = page.getByRole('button', { name: '重试', exact: true })
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page, `正式付款管理 ${outcome} ${width}px`)
        await managementRetry.scrollIntoViewIfNeeded()
        await managementRetry.focus()
        await expect(managementRetry).toBeFocused()
        await expect(managementRetry).toBeInViewport()
      }
      managementReadFailed = false
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('payment-management-summary-unknown')).toHaveCount(0)
      await expect(page.getByText('正式真实付款详情', { exact: true })).toBeVisible()
      await expect(page.getByRole('group', { name: '已支付', exact: true })).toContainText('¥0.00')
      await page.getByText('正式真实付款详情', { exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/finance/payment/${application.id}/detail`))
      await expect(page.getByTestId('payment-application-insight')).toBeVisible()
      await page.getByTestId('payment-application-edit').click()
      await expect(page).toHaveURL(new RegExp(`/finance/payment/${application.id}(?:\\?|$)`))
      await expect(page.getByTestId('finance-amount')).toHaveValue('100')
      if (outcome === 'unknown') {
        await page.goto(`${f.origin}/finance/payment-management?origin=real`)
        const action = page.getByRole('button', { name: '正式真实付款详情付款操作' })
        await expect(action).toBeVisible()
        await action.click()
        await page.getByRole('menuitem', { name: '登记支付记录', exact: true }).click()
        await expect(page).toHaveURL(/\/finance\/records\/new\?/)
        await expect(page).toHaveURL(new RegExp(`paymentApplicationId=${application.id}`))
        await expect(page.getByTestId('finance-amount')).toHaveValue('100')
      }
      await f.stop()
      const disk = new DatabaseSync(join(f.directory, 'ruihang.sqlite'), { readOnly: true })
      try {
        expect(disk.prepare('SELECT COUNT(*) AS n FROM finance_commands WHERE command_id=?').get(originalCommand)).toEqual({ n: 1 })
        expect(disk.prepare('SELECT COUNT(*) AS n FROM finance_history WHERE kind=\'current\' AND id=?').get(seed.id)).toEqual({ n: 2 })
        expect(disk.prepare('SELECT amount FROM current_transactions WHERE id=?').get(seed.id)).toEqual({ amount: 10 })
        expect(disk.prepare('SELECT COUNT(*) AS n FROM payment_records').get()).toEqual({ n: 0 })
      }
      finally { disk.close() }
      expect(errors).toEqual([])
    }
    finally { await f.cleanup() }
  })
}
