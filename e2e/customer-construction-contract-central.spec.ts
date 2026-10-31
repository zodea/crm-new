import type { Page, Request, TestInfo } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { createVerifiedSignatory, selectVerifiedSignatory, verifiedSignatoryAdoption } from './helpers/contract-signatory'
import { expectNoPageOverflow, expectOverlayAboveShell } from './helpers/responsive'

test.use({ screenshot: 'off', video: 'off', trace: 'off' })

const adoptedSignatories = new WeakMap<Page, Awaited<ReturnType<typeof verifiedSignatoryAdoption>>>()
interface NetworkDiagnosticRequest {
  url: string
  resourceType: string
  startedAt: number
  finishedAt?: number
  status?: number
  failure?: string
}
const browserDiagnostics = new WeakMap<Page, {
  console: { type: string, text: string }[]
  pageErrors: string[]
  requests: { url: string, method: string, status?: number, failure?: string }[]
  network: { started: number, finished: number, failed: number, pending: number, peak: number, requests: NetworkDiagnosticRequest[] }
}>()

function observeBrowserDiagnostics(page: Page) {
  const diagnostics = { console: [] as { type: string, text: string }[], pageErrors: [] as string[], requests: [] as { url: string, method: string, status?: number, failure?: string }[], network: { started: 0, finished: 0, failed: 0, pending: 0, peak: 0, requests: [] as NetworkDiagnosticRequest[] } }
  const networkRequests = new WeakMap<Request, NetworkDiagnosticRequest>()
  page.on('request', (request) => {
    const entry = { url: request.url(), resourceType: request.resourceType(), startedAt: Date.now() }
    networkRequests.set(request, entry)
    diagnostics.network.requests.push(entry)
    diagnostics.network.started++
    diagnostics.network.pending++
    diagnostics.network.peak = Math.max(diagnostics.network.peak, diagnostics.network.pending)
  })
  const finishRequest = (request: Request, failed: boolean) => {
    const entry = networkRequests.get(request)
    if (!entry || entry.finishedAt !== undefined)
      return
    entry.finishedAt = Date.now()
    if (failed) {
      entry.failure = request.failure()?.errorText
      diagnostics.network.failed++
    }
    else {
      diagnostics.network.finished++
    }
    diagnostics.network.pending--
  }
  page.on('requestfinished', request => finishRequest(request, false))
  page.on('requestfailed', request => finishRequest(request, true))
  browserDiagnostics.set(page, diagnostics)
  page.on('console', message => diagnostics.console.push({ type: message.type(), text: message.text() }))
  page.on('pageerror', error => diagnostics.pageErrors.push(error.stack ?? error.message))
  page.on('requestfailed', request => diagnostics.requests.push({ url: request.url(), method: request.method(), failure: request.failure()?.errorText }))
  page.on('response', (response) => {
    const request = response.request()
    const entry = networkRequests.get(request)
    if (entry)
      entry.status = response.status()
    if (response.status() >= 400 || request.resourceType() === 'document' || response.url().includes('/api/'))
      diagnostics.requests.push({ url: response.url(), method: request.method(), status: response.status() })
  })
}

async function captureDiagnostic<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([read(), new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('诊断读取未及时返回；保留原测试失败及已采集事件')), 5000)
    })])
  }
  finally {
    clearTimeout(timer)
  }
}

const CUSTOMER_INPUTS = [
  { label: '整数与施工阶段', marker: '甲', contact: '受控联系人甲', manager: '受控经理甲', stage: '施工中', date: '2026-09-09', amount: 123400, secondaryAmount: 456700, editedAmount: '234500', editedFormatted: '234,500.00' },
  { label: '小数与闰日筹备阶段', marker: '乙', contact: '受控联系人乙', manager: '受控经理乙', stage: '筹备中', date: '2024-02-29', amount: 113.25, secondaryAmount: 226.5, editedAmount: '226.5', editedFormatted: '226.50' },
] as const

for (const input of CUSTOMER_INPUTS) {
  test.describe(input.label, () => {
    const named = (base: string) => `${base}-${input.marker}`
    test.setTimeout(120_000)

    function headers(info: TestInfo) {
      return { 'x-ruihang-test-session': `customer-contract-${Buffer.from(info.testId).toString('base64url')}` }
    }

    async function reset(page: Page, info: TestInfo) {
      for (const entity of ['construction-contracts', 'projects', 'customers']) {
        const result = await page.context().request.post(`/api/testing/${entity}/reset`, {
          headers: { ...headers(info), 'x-ruihang-test-reset': '1' },
          data: { scenario: entity === 'construction-contracts' ? 'empty' : 'ready' },
        })
        expect(result.ok()).toBe(true)
      }
      // 显式测试入口准备中央身份；随后清空合同，以验证真正的首次保存回读。
      for (const scenario of ['ready', 'empty']) {
        const result = await page.context().request.post('/api/testing/construction-contracts/reset', {
          headers: { ...headers(info), 'x-ruihang-test-reset': '1' },
          data: { scenario },
        })
        expect(result.ok()).toBe(true)
      }
    }

    async function saveEntity(page: Page, entity: 'customers' | 'projects' | 'construction-contracts', draft: Record<string, unknown>, id?: string) {
      const adoptedDraft = entity === 'construction-contracts' && !id ? { ...adoptedSignatories.get(page), ...draft } : draft
      return page.evaluate(async ({ entity, draft, id }) => {
        const session = await (await fetch('/api/read/business-session')).json()
        const form = id ? await (await fetch(`/api/read/${entity}/${id}/form`)).json() : null
        const response = await fetch(`/api/commands/${entity}${id ? `/${id}` : ''}`, {
          method: id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId: session.workspaceId, actorId: session.actorId, ...(id ? { id } : {}), requiredCapability: entity === 'customers' ? 'customer:write' : entity === 'projects' ? 'project:write' : 'construction-contract:write', commandId: crypto.randomUUID(), baseVersion: form?.version ?? null, action: 'save', draft: { ...form?.draft, ...draft }, attachments: {} }),
        })
        const result = await response.json()
        if (!response.ok)
          throw new Error(`合成${entity}保存失败：${JSON.stringify(result)}`)
        return result as { id: string, version: string }
      }, { entity, draft: adoptedDraft, id })
    }

    const saveContract = (page: Page, name: string, amount = input.amount) => saveEntity(page, 'construction-contracts', { name, amount, projectId: 'project-real-320', customerId: 'customer-real-320', content: '隔离合成施工', signDate: input.date, status: '履约中' })
    const customerUrl = '/base/customer/customer-real-320?origin=real&tab=contracts'

    test.beforeEach(async ({ page }, info) => {
      observeBrowserDiagnostics(page)
      await page.addInitScript(() => {
        Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
      })
      await page.context().setExtraHTTPHeaders(headers(info))
      await page.setExtraHTTPHeaders(headers(info))
      await page.clock.install({ time: new Date(`${input.date}T04:00:00Z`) })
      await reset(page, info)
      const ownId = await createVerifiedSignatory(page, named('客户合同已核实我方主体425'), headers(info)['x-ruihang-test-session'])
      adoptedSignatories.set(page, await verifiedSignatoryAdoption(page, ownId, headers(info)['x-ruihang-test-session']))
      await page.goto('/base/customer')
      await expect(page.getByRole('heading', { name: '客户档案', exact: true })).toBeVisible({ timeout: 30_000 })
    })

    test.afterEach(async ({ page }, info) => {
      const network = browserDiagnostics.get(page)?.network
      if (network) {
        const sourceRequests = network.requests.filter((request) => {
          const path = new URL(request.url).pathname
          return /^\/_nuxt\/(?:app\/)?(?:components|composables|lib|stores|pages|plugins|layouts|utils|middleware)\//.test(path)
            && /\.(?:vue|[cm]?[jt]sx?)$/.test(path)
        })
        await info.attach('browser-network-summary', {
          contentType: 'application/json',
          body: JSON.stringify({
            total: network.started,
            finished: network.finished,
            failed: network.failed,
            pending: network.pending,
            peak: network.peak,
            sourceRequests: sourceRequests.length,
            uniqueSourceUrls: new Set(sourceRequests.map(request => request.url)).size,
            failedUrls: network.requests.filter(request => request.failure).map(request => ({ url: request.url, failure: request.failure })),
            failedSourceUrls: sourceRequests.filter(request => request.failure).map(request => request.url),
          }),
        })
      }
      if (info.status !== info.expectedStatus) {
        await info.attach('failed-browser-events', { contentType: 'application/json', body: JSON.stringify({ url: page.url(), viewport: page.viewportSize(), browser: browserDiagnostics.get(page) }) })
        try {
          const dom = await captureDiagnostic(() => page.evaluate(() => {
            const retainedNavigation = (storage: Storage) => Object.fromEntries(Object.keys(storage)
              .filter(key => key.startsWith('ruihang:customer-') || key.startsWith('ruihang:construction-contract-return:') || key.startsWith('ruihang:tab-session:'))
              .map(key => [key, storage.getItem(key)]))
            return {
              readyState: document.readyState,
              title: document.title,
              text: document.body?.textContent ?? null,
              html: document.documentElement.outerHTML,
              now: Date.now(),
              sessionNavigation: retainedNavigation(sessionStorage),
              localNavigation: retainedNavigation(localStorage),
              navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
              resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
            }
          }))
          await info.attach('failed-browser-dom', { contentType: 'application/json', body: JSON.stringify(dom) })
        }
        catch (cause) {
          await info.attach('failed-browser-dom-error', { contentType: 'text/plain', body: String(cause) })
        }
        const contractId = /^\/contract\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1]
        const urls = ['/api/read/business-session', '/api/read/customers/customer-real-320?origin=real&includeDemo=false', ...(contractId ? [`/api/read/construction-contracts/${contractId}?origin=real`] : [])]
        const reads = await Promise.allSettled(urls.map(async (url) => {
          const response = await page.context().request.get(url, { headers: headers(info), timeout: 5000 })
          return { url, status: response.status(), body: await response.text() }
        }))
        await info.attach('failed-server-reads', { contentType: 'application/json', body: JSON.stringify(reads.map((result, index) => result.status === 'fulfilled' ? result.value : { url: urls[index], error: String(result.reason) })) })
      }
      await reset(page, info)
    })

    if (input.marker === '甲') {
      test('总合同管理费整页配置五档键盘保存、历史及项目独立读回，供应商表单不显示', async ({ page }) => {
        const contract = await saveContract(page, '管理费独立配置总合同')
        await page.goto(`/contract/construction/form/${contract.id}`)
        const amount = page.getByTestId('contract-management-fee-amount')
        const basis = page.getByTestId('contract-management-fee-basis')
        await expect(amount).toHaveValue('')
        await amount.fill('0')
        await basis.fill('总合同原件第八条：明确不记取管理费；合成配置证据')
        const save = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })
        for (const width of [390, 768, 1024, 1280, 1440]) {
          await test.step(`管理费配置表单 ${width}`, async () => {
            await page.setViewportSize({ width, height: 900 })
            await amount.scrollIntoViewIfNeeded()
            await amount.focus()
            await expect(amount).toBeFocused()
            await page.keyboard.press('Tab')
            await expect(basis).toBeFocused()
            await expectNoPageOverflow(page, `总合同配置表单 ${width}`)
            await save.focus()
            await expect(save).toBeFocused()
          })
        }
        const saved = page.waitForResponse(response => response.url().endsWith(`/api/commands/construction-contracts/${contract.id}`) && response.request().method() === 'PUT')
        await save.press('Enter')
        expect((await saved).ok()).toBe(true)
        const current = page.getByTestId('construction-management-fee-configuration')
        await expect(current.getByTestId('construction-management-fee-amount')).toContainText('0.00')
        await expect(current).toContainText('总合同原件第八条')
        await saveEntity(page, 'construction-contracts', { managementFeeAmount: 1200, managementFeeBasis: '同份总合同修订采用证据' }, contract.id)
        await page.reload()
        for (const width of [390, 768, 1024, 1280, 1440]) {
          await test.step(`配置历史 ${width}`, async () => {
            await page.setViewportSize({ width, height: 900 })
            const history = current.locator('summary')
            await history.scrollIntoViewIfNeeded()
            await history.focus()
            await expect(history).toBeFocused()
            await history.press('Enter')
            await expect(current.getByTestId('construction-management-fee-history')).toHaveCount(2)
            await expect(current).toContainText('明确不记取管理费')
            await expectNoPageOverflow(page, `总合同配置历史 ${width}`)
            await history.press('Enter')
          })
        }
        await page.goto('/project/project-real-320?origin=real')
        const project = page.getByTestId('project-construction-management-fees')
        await expect(project).toContainText('管理费独立配置总合同')
        await expect(project).toContainText('1,200.00')
        await expect(page.getByRole('region', { name: '管理费实际成本' })).toContainText('总额未知')
        await project.getByRole('link', { name: '查看总合同' }).click()
        await expect(page.getByRole('heading', { name: '管理费独立配置总合同', exact: true })).toBeVisible()
        await page.getByRole('link', { name: '返回项目详情', exact: true }).click()
        await expect(page.getByTestId('project-construction-management-fees')).toContainText('同份总合同修订采用证据')
        await page.goto('/contract/material/form')
        await expect(page.getByRole('heading', { name: '新建 · 材料采购合同', exact: true })).toBeVisible()
        await expect(page.getByTestId('contract-management-fee-amount')).toHaveCount(0)
      })

      for (const recovery of ['unknown-cold', 'saved-read-failed'] as const) {
        test(`总合同管理费${recovery}原编号恢复五档仍只写一次`, async ({ page }) => {
          const contract = await saveContract(page, `管理费恢复-${recovery}`)
          await page.goto(`/contract/construction/form/${contract.id}`)
          await page.getByTestId('contract-management-fee-amount').fill('0')
          await page.getByTestId('contract-management-fee-basis').fill(`合成原合同依据-${recovery}`)
          let writes = 0
          let resolutions = 0
          let blockedResolve = recovery === 'unknown-cold'
          let blockedRead = recovery === 'saved-read-failed'
          let applied = false
          let originalCommand = ''
          await page.route(`**/api/commands/construction-contracts/${contract.id}`, async (route) => {
            if (route.request().method() !== 'PUT')
              return route.continue()
            writes++
            originalCommand = route.request().postDataJSON().commandId
            const response = await route.fetch()
            expect(response.ok()).toBe(true)
            applied = true
            if (recovery === 'unknown-cold')
              return route.abort('failed')
            return route.fulfill({ response })
          })
          await page.route('**/api/commands/construction-contracts/resolve', async (route) => {
            resolutions++
            expect(route.request().postDataJSON()).toEqual({ commandId: originalCommand })
            if (blockedResolve)
              return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成原提交核对暂不可用' }) })
            return route.continue()
          })
          await page.route(`**/api/read/construction-contracts/${contract.id}/form`, async (route) => {
            if (applied && blockedRead)
              return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '合成保存后的原合同读取503' }) })
            return route.continue()
          })
          await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
          const panel = page.getByRole('status', { name: '原提交恢复' })
          await expect(panel).toContainText(recovery === 'unknown-cold' ? '原提交结果未知' : '已保存待刷新')
          if (recovery === 'unknown-cold') {
            await page.reload()
            await expect(panel).toContainText('原提交结果未知')
          }
          await expect(panel).toContainText(originalCommand)
          const resolutionAttemptsBeforeRecovery = recovery === 'unknown-cold' ? 1 : 0
          expect(resolutions).toBe(resolutionAttemptsBeforeRecovery)
          const resume = panel.getByRole('button', { name: recovery === 'unknown-cold' ? '核对原提交' : '重新读取已保存记录', exact: true })
          for (const width of [390, 768, 1024, 1280, 1440]) {
            await test.step(`${recovery} 恢复 ${width}`, async () => {
              await page.setViewportSize({ width, height: 900 })
              await resume.scrollIntoViewIfNeeded()
              await resume.focus()
              await expect(resume).toBeFocused()
              await expectNoPageOverflow(page, `总合同配置恢复 ${width}`)
              expect(writes).toBe(1)
              expect(resolutions).toBe(resolutionAttemptsBeforeRecovery)
            })
          }
          blockedRead = false
          blockedResolve = false
          await resume.press('Enter')
          await expect(panel).toHaveCount(0)
          await expect(page.getByTestId('contract-management-fee-amount')).toHaveValue('0')
          await expect(page.getByTestId('contract-management-fee-basis')).toHaveValue(`合成原合同依据-${recovery}`)
          expect(writes).toBe(1)
          expect(resolutions).toBe(resolutionAttemptsBeforeRecovery + (recovery === 'unknown-cold' ? 1 : 0))
          const read = await page.context().request.get(`/api/read/construction-contracts/${contract.id}?origin=real`)
          expect(read.ok()).toBe(true)
          const detail = await read.json()
          expect(detail.contract.managementFee.history).toHaveLength(1)
          expect(detail.contract.managementFee.history[0].commandId).toBe(originalCommand)
          await page.goto(`/contract/${contract.id}?origin=real&contractKind=construction`)
          await expect(page.getByTestId('construction-management-fee-amount')).toContainText('0.00')
          await expect(page.getByTestId('construction-management-fee-configuration')).toContainText(`合成原合同依据-${recovery}`)
        })
      }
    }

    test('正式施工合同表单保存后客户回读同一合同并往返详情', async ({ page }, info) => {
      await page.goto('/contract/construction/form')
      await selectVerifiedSignatory(page, adoptedSignatories.get(page)!.ourSignatoryId, named('客户合同已核实我方主体425'))
      await page.getByLabel('合同名称 *').fill(named('合成客户合同回读407'))
      await page.getByRole('combobox', { name: '检索项目' }).click()
      await page.getByText('中央正式施工项目', { exact: true }).click()
      await page.getByRole('combobox', { name: '检索客户' }).click()
      await page.getByText('中央正式甲方客户', { exact: true }).click()
      await page.getByLabel('合同内容简述 *').fill('隔离合成施工合同回读')
      await page.getByLabel('签约日期 *').fill(input.date)
      const originalText = `施工合同签署原件-${input.marker}`
      await page.locator('#section-attachments input[type="file"]').setInputFiles({ name: 'signed-contract.txt', mimeType: 'text/plain', buffer: Buffer.from(originalText) })
      const saved = page.waitForResponse(response => response.url().endsWith('/api/commands/construction-contracts') && response.request().method() === 'POST')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      const response = await saved
      expect(response.ok(), await response.text()).toBe(true)
      const contract = await response.json()
      await expect(page.getByRole('heading', { name: named('合成客户合同回读407'), exact: true })).toBeVisible()
      const originals = page.getByRole('region', { name: '合同原件附件' })
      await expect(originals).toContainText('signed-contract.txt')
      await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15_000 })
      for (const width of [390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await originals.scrollIntoViewIfNeeded()
        await expectNoPageOverflow(page, `施工合同原件 ${width}`)
        const preview = originals.getByRole('button', { name: '预览', exact: true })
        await preview.focus()
        await expect(preview).toBeFocused()
        await preview.press('Enter')
        const dialog = page.getByRole('dialog')
        await expect(dialog.locator('iframe')).toHaveAttribute('src', /^blob:/)
        await expectOverlayAboveShell(dialog, `施工合同原件预览 ${width}`)
        await dialog.press('Escape')
        await expect(preview).toBeFocused()
      }
      const downloadPromise = page.waitForEvent('download')
      await originals.getByRole('button', { name: '下载', exact: true }).click()
      const downloaded = await downloadPromise
      const originalPath = info.outputPath('signed-contract.txt')
      await downloaded.saveAs(originalPath)
      expect(await readFile(originalPath, 'utf8')).toBe(originalText)
      const form = await page.evaluate(async id => (await (await fetch(`/api/read/construction-contracts/${id}/form`)).json()), contract.id)
      expect(form.draft.customerId).toBe('customer-real-320')
      await page.goto('/base/customer/customer-real-320?origin=real&tab=contracts')
      await expect(page.getByRole('heading', { name: '中央正式甲方客户', exact: true })).toBeVisible()
      const detail = await page.evaluate(async () => (await (await fetch('/api/read/customers/customer-real-320?origin=real&includeDemo=false')).json()))
      expect(detail.summary.contractCount, '中央正式施工合同已保存，客户详情应回读同一合同事实').toBe(1)
      expect(detail.contracts[0].contract.id).toBe(contract.id)
      const link = page.getByRole('link', { name: named('合成客户合同回读407'), exact: true })
      await link.click()
      await expect(page.getByRole('heading', { name: named('合成客户合同回读407'), exact: true })).toBeVisible()
      await page.reload()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(page.getByRole('tab', { name: /施工合同/ })).toHaveAttribute('aria-selected', 'true')
      await expect(link).toBeFocused()
    })

    test('新建合成客户与项目可用于施工合同正式保存，同名次客户不取得合同', async ({ page }) => {
      const a = await saveEntity(page, 'customers', { name: named('同名合成甲方425'), contact: '主客户' })
      const b = await saveEntity(page, 'customers', { name: named('同名合成甲方425'), contact: '次客户' })
      const p = await saveEntity(page, 'projects', { name: named('新建施工关联项目425'), manager: input.manager, customerId: a.id, secondaryCustomerId: b.id })
      await page.goto('/contract/construction/form')
      await page.getByRole('combobox', { name: '检索项目' }).click()
      await expect(page.getByText(named('新建施工关联项目425'), { exact: true }), '新保存中央项目必须出现在正式合同候选').toBeVisible()
      await page.keyboard.press('Escape')
      const c = await saveEntity(page, 'construction-contracts', { name: named('新客户施工合同425'), projectId: p.id, customerId: a.id, amount: input.amount, content: '新合成施工', signDate: input.date })
      await page.goto(`/base/customer/${a.id}?origin=real&tab=contracts`)
      await page.getByRole('link', { name: named('新客户施工合同425'), exact: true }).click()
      await expect(page.getByRole('heading', { name: named('新客户施工合同425'), exact: true })).toBeVisible()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/base/customer/${a.id}\\?`))
      await saveEntity(page, 'projects', { customerId: b.id, secondaryCustomerId: null }, p.id)
      await page.reload()
      await expect(page.getByRole('link', { name: named('新客户施工合同425'), exact: true })).toBeVisible()
      await page.goto(`/base/customer/${b.id}?origin=real&tab=contracts`)
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无施工合同' })).toBeVisible()
      await saveEntity(page, 'construction-contracts', { customerId: b.id }, c.id)
      await page.reload()
      await expect(page.getByRole('link', { name: named('新客户施工合同425'), exact: true })).toBeVisible()
      await saveEntity(page, 'customers', { name: '甲方更名后425' }, b.id)
      await page.reload()
      await expect(page.getByRole('heading', { name: '甲方更名后425', exact: true })).toBeVisible()
      await page.getByRole('link', { name: named('新客户施工合同425'), exact: true }).click()
      await expect(page.getByRole('link', { name: '甲方更名后425', exact: true })).toBeVisible()
    })

    test('五档视口合同往返恢复原行、表内横滚，键盘与来源确认浮层可达', async ({ page, browser }, info) => {
      const first = await saveContract(page, named('第一份同项目施工合同425'))
      const second = await saveContract(page, named('第二份同项目施工合同425'), input.secondaryAmount)
      expect(first.id).not.toBe(second.id)
      for (const width of [390, 768, 1024, 1280, 1440]) {
        const context = await browser.newContext({ baseURL: info.project.use.baseURL, extraHTTPHeaders: headers(info), viewport: { width, height: width === 390 ? 844 : 1024 } })
        let ownedPage: Page | undefined
        let phase = '直达客户详情'
        try {
          const matrixPage = await context.newPage()
          ownedPage = matrixPage
          observeBrowserDiagnostics(matrixPage)
          await matrixPage.addInitScript(() => {
            localStorage.setItem('ruihang:workspace-default:include-demo', 'false')
            Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined })
          })
          await matrixPage.clock.install({ time: new Date(`${input.date}T04:00:00Z`) })
          await matrixPage.goto(customerUrl)
          await expect(matrixPage).toHaveURL(/\/base\/customer\/customer-real-320\?/)
          const current = new URL(matrixPage.url())
          expect(current.searchParams.get('origin')).toBe('real')
          expect(current.searchParams.get('tab')).toBe('contracts')
          const link = matrixPage.getByRole('link', { name: named('第二份同项目施工合同425'), exact: true })
          await expect(link).toBeVisible()
          await expect(matrixPage.getByRole('link', { name: named('第一份同项目施工合同425'), exact: true })).toHaveAttribute('data-customer-target-id', first.id)
          await expect(link).toHaveAttribute('data-customer-target-id', second.id)
          await expectNoPageOverflow(matrixPage, `客户施工合同 @ ${width}`)
          const table = matrixPage.locator('[data-customer-relations] .vxe-table--scroll-x-handle').first()
          const scrollLeft = await table.evaluate((element) => {
            element.scrollLeft = Math.min(110, element.scrollWidth - element.clientWidth)
            return element.scrollLeft
          })
          if (width <= 1280)
            expect(scrollLeft).toBeGreaterThan(0)
          await expect(link, '未操作的合同链接不应自动聚焦').not.toBeFocused()
          await expect.poll(() => link.evaluate(element => element.matches(':hover')), { message: '普通页面截图不应带入鼠标悬停状态' }).toBe(false)
          phase = '键盘打开原合同'
          await link.focus()
          await expect(link).toBeFocused()
          await link.press('Enter')
          await expect(matrixPage.getByRole('heading', { name: named('第二份同项目施工合同425'), exact: true })).toBeVisible()
          await expectNoPageOverflow(matrixPage, `施工合同详情 @ ${width}`)
          phase = '重载原合同并键盘返回'
          await matrixPage.reload()
          await matrixPage.getByRole('link', { name: '返回客户详情', exact: true }).press('Enter')
          phase = '恢复原行焦点及局部滚动'
          await expect(link).toBeFocused()
          await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBe(scrollLeft)
          phase = '来源浮层及Escape返回'
          await matrixPage.getByRole('button', { name: '包含测试数据' }).click()
          const dialog = matrixPage.getByRole('dialog')
          await expect(dialog).toBeVisible()
          await expectOverlayAboveShell(dialog, `来源浮层 @ ${width}`)
          await matrixPage.keyboard.press('Escape')
          await expect(dialog).toHaveCount(0)
        }
        catch (cause) {
          const matrixPage = ownedPage
          if (!matrixPage) {
            await info.attach(`customer-contract-${width}-diagnostic-error`, { contentType: 'application/json', body: JSON.stringify({ width, phase, diagnosticError: '独立页面尚未建立', originalError: String(cause) }) })
            throw cause
          }
          try {
            const dom = await captureDiagnostic(() => matrixPage.evaluate(() => ({ readyState: document.readyState, title: document.title, text: document.body?.textContent ?? null, html: document.documentElement.outerHTML })))
            const observed = browserDiagnostics.get(matrixPage)
            await info.attach(`customer-contract-${width}-diagnostic`, { contentType: 'application/json', body: JSON.stringify({ width, phase, url: matrixPage.url(), dom, browser: observed, actualApiFailures: observed?.requests.filter(request => request.url.includes('/api/') && (request.failure || (request.status !== undefined && request.status >= 400))) }) })
          }
          catch (diagnosticError) {
            await info.attach(`customer-contract-${width}-diagnostic-error`, { contentType: 'application/json', body: JSON.stringify({ width, phase, url: matrixPage.url(), browser: browserDiagnostics.get(matrixPage), diagnosticError: String(diagnosticError) }) })
          }
          throw cause
        }
        finally {
          if (ownedPage)
            browserDiagnostics.delete(ownedPage)
          await context.close()
        }
      }
    })

    test('合同显式编辑并保存后回客户刷新金额，保留原列表分页与筛选', async ({ page }) => {
      await saveContract(page, named('编辑往返合成合同425'))
      const list = '/base/customer?search=中央正式&status=active&sort=name-desc&page=2&pageSize=10'
      for (let index = 0; index < 11; index++)
        await saveEntity(page, 'customers', { name: `中央正式甲方客户${index}`, contact: '分页合成联系人' })
      await page.goto(list)
      await expect(page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })).toHaveValue('中央正式')
      await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
      await page.getByRole('link', { name: '中央正式甲方客户', exact: true }).click()
      await page.getByRole('tab', { name: /施工合同/ }).click()
      await page.getByRole('link', { name: named('编辑往返合成合同425'), exact: true }).click()
      await page.getByTestId('construction-contract-edit').click()
      await page.getByLabel('合同名称 *').fill(named('合同更正后425'))
      await page.getByLabel('含税合同金额 *', { exact: true }).fill(input.editedAmount)
      const saved = page.waitForResponse(response => response.url().includes('/api/commands/construction-contracts/') && response.request().method() === 'PUT')
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      expect((await saved).ok()).toBe(true)
      await expect(page.getByRole('heading', { name: named('合同更正后425'), exact: true })).toBeVisible()
      await page.reload()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(page.getByRole('link', { name: named('合同更正后425'), exact: true })).toBeFocused()
      await expect(page.getByTestId('customer-summary')).toContainText(input.editedFormatted)
      await page.reload()
      await expect(page.getByRole('tab', { name: /施工合同/ })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('link', { name: '返回客户列表', exact: true })).toHaveAttribute('href', /search=/)
      await page.getByRole('link', { name: '返回客户列表', exact: true }).click()
      await expect(page.getByRole('searchbox', { name: '搜索客户名称、简称、税号或联系人…' })).toHaveValue('中央正式')
      const url = new URL(page.url())
      for (const [key, value] of new URL(list, 'http://localhost').searchParams)
        expect(url.searchParams.get(key) ?? (key === 'pageSize' ? '10' : null)).toBe(value)
      await expect(page.getByRole('button', { name: '第 2 页' })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('link', { name: '中央正式甲方客户', exact: true })).toBeFocused()
    })

    test('合同源失败/无权反馈与重试，正式演示来源和会话隔离', async ({ page }, info) => {
      const c = await saveContract(page, named('异常合成合同425'))
      for (const scenario of ['forbidden', 'unavailable']) {
        await page.context().request.post('/api/testing/construction-contracts/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario } })
        await page.goto(customerUrl)
        await expect(page.getByRole('heading', { name: '中央正式甲方客户', exact: true })).toBeVisible()
        await expect(page.getByRole(scenario === 'forbidden' ? 'status' : 'alert', { name: scenario === 'forbidden' ? '无权查看施工合同' : '施工合同加载失败' })).toBeVisible()
        await expect(page.getByRole('tabpanel', { name: '施工合同' })).not.toContainText('暂无施工合同')
        await expect(page.getByTestId('customer-summary')).not.toContainText('0 份')
        await expect(page.getByRole('link', { name: named('异常合成合同425'), exact: true })).toHaveCount(0)
      }
      await page.context().request.post('/api/testing/construction-contracts/reset', { headers: { ...headers(info), 'x-ruihang-test-reset': '1' }, data: { scenario: 'ready' } })
      await saveContract(page, named('恢复后合成合同425'))
      await page.getByRole('button', { name: '重新加载施工合同' }).click()
      await expect(page.getByRole('link', { name: named('恢复后合成合同425'), exact: true })).toBeVisible()
      const other = await page.context().request.get('/api/read/customers/customer-real-320?origin=real&includeDemo=false', { headers: { 'x-ruihang-test-session': `other-${info.testId}` } })
      expect(other.status()).toBe(404)
      expect(await other.text()).not.toContain(c.id)
      await page.getByRole('button', { name: '包含测试数据' }).click()
      await page.getByRole('button', { name: '确认切换' }).click()
      await expect(page.getByRole('button', { name: '关闭测试数据' })).toBeVisible()
      await page.goto('/base/customer/customer_demo_001?origin=demo&tab=contracts')
      await expect(page.getByRole('heading', { name: '合和地产集团', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: named('恢复后合成合同425'), exact: true })).toHaveCount(0)
      await page.getByRole('link', { name: '合和新城施工总承包合同', exact: true }).click()
      await expect(page).toHaveURL(/origin=demo&contractKind=construction/)
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(page.getByRole('tab', { name: /施工合同/ })).toHaveAttribute('aria-selected', 'true')
      expect(page.url()).not.toContain(c.id)
    })

    test('合同详情保持打开直到客户返回信息到期，自动降级到施工合同列表', async ({ page }) => {
      await saveContract(page, named('停留到期合成合同425'))
      await page.goto(customerUrl)
      await page.clock.install()
      await page.getByRole('link', { name: named('停留到期合成合同425'), exact: true }).click()
      await expect(page.getByRole('heading', { name: named('停留到期合成合同425'), exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: '返回客户详情', exact: true })).toBeVisible()
      await page.clock.fastForward(31 * 60_000)
      await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toHaveAttribute('href', '/contract/construction')
    })

    test('合同目标读取失败仍可返回，深链/伪造/过期上下文降级；原行消失聚焦关系区', async ({ page }, info) => {
      const c = await saveContract(page, named('安全返回合成合同425'))
      await page.goto(customerUrl)
      const link = page.getByRole('link', { name: named('安全返回合成合同425'), exact: true })
      await page.route(`**/api/read/construction-contracts/${c.id}?**`, route => route.abort('connectionreset'))
      await link.click()
      await expect(page.getByRole('alert')).toBeVisible()
      const capturedUrl = page.url()
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(link).toBeFocused()
      await page.unroute(`**/api/read/construction-contracts/${c.id}?**`)
      await page.goto(`/contract/${c.id}?origin=real&contractKind=construction`)
      await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toHaveAttribute('href', '/contract/construction')
      await page.evaluate(() => {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith('ruihang:customer-relation-return:')) {
            const value = JSON.parse(sessionStorage.getItem(key)!)
            value.expiresAt = 1
            sessionStorage.setItem(key, JSON.stringify(value))
          }
        }
      })
      await page.goto(capturedUrl)
      await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toBeVisible()
      await page.goto(`/contract/${c.id}?origin=real&contractKind=construction&returnTo=${encodeURIComponent('https://evil.example')}`)
      await expect(page.getByRole('link', { name: '返回施工合同列表', exact: true })).toHaveAttribute('href', '/contract/construction')
      await page.goto(customerUrl)
      await link.click()
      await expect(page.getByRole('heading', { name: named('安全返回合成合同425'), exact: true })).toBeVisible()
      await reset(page, info)
      await page.getByRole('link', { name: '返回客户详情', exact: true }).click()
      await expect(page.locator('[data-ui="kit-table-empty"]:visible').filter({ hasText: '暂无施工合同' })).toBeVisible()
      await expect(page.locator('[data-customer-relations]')).toBeFocused()
    })
  })
}
