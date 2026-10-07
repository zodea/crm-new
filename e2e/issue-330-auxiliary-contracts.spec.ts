import type { Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { runMigrations } from '../app/lib/db/migrations'
import { createMemoryDb } from '../tests/helpers/memory-db'
import { expectEscapeReturnsFocus, expectLocalHorizontalScroll, expectNoPageOverflow, expectOverlayAboveShell, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.describe('AX04 辅助合同只读与编辑', () => {
  test.beforeEach(async ({ page }, info) => {
    const session = Buffer.from(info.testId).toString('base64url')
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
    for (const domain of ['projects', 'suppliers', 'construction-contracts', 'auxiliary-contracts']) {
      const response = await page.request.post(`/api/testing/${domain}/reset`, { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session }, data: { scenario: 'ready' } })
      expect(response.ok(), await response.text()).toBe(true)
    }
  })
  test('两类列表进入只读详情，显式编辑保存，刷新及来源返回', async ({ page }) => {
    test.setTimeout(180000)
    for (const [kind, name] of [['other-expense', '验收检测服务合同'], ['company-expense', '办公室租赁合同']]) {
      await page.goto(`/contract/${kind}?search=${encodeURIComponent(name!)}&pageSize=10`)
      await page.getByRole('link', { name, exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
      await expect(page.getByLabel('合同名称 *')).toHaveCount(0)
      const detailURL = page.url()
      await page.getByRole('button', { name: '编辑合同', exact: true }).click()
      await expect(page).toHaveURL(/\/form\//)
      await page.getByLabel('合同名称 *').fill(`${name}（已修改）`)
      if (kind === 'company-expense')
        await expect(page.getByRole('combobox', { name: '检索项目' })).toHaveCount(0)
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toContainText(`${name}（已修改）`)
      await page.reload()
      await expect(page.getByTestId('auxiliary-detail')).toContainText(`${name}（已修改）`)
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page, `${kind} 详情 ${width}`)
      }
      await page.getByRole('button', { name: '返回来源', exact: true }).click()
      await expect(page.getByPlaceholder('搜索合同名称 / 编号 / 对方单位')).toHaveValue(name!)
      await page.goto(detailURL)
      await page.getByRole('button', { name: '收票登记', exact: true }).click()
      await expect(page.getByText('暂无收票记录', { exact: true })).toBeVisible()
    }
  })
  test('真实项目和分供方往返保持稳定关系及来源位置', async ({ page }) => {
    await page.goto('/contract/other-expense')
    await page.getByRole('link', { name: '验收检测服务合同', exact: true }).click()
    for (const [name, path] of [['中央正式施工项目', '/project/project-real-320'], ['中央正式劳务分供方', '/base/supplier/supplier-real-327']]) {
      await page.getByTestId('auxiliary-detail').getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(path!))
      await page.getByTestId('auxiliary-journey').getByRole('link', { name: '查看其他支出合同' }).click()
      await expect(page.getByTestId('auxiliary-list')).toContainText('限定')
      await page.getByRole('link', { name: '返回来源', exact: true }).click()
      await expect(page.getByTestId('auxiliary-journey').getByRole('link')).toBeFocused()
      await page.getByRole('link', { name: /返回其他支出合同|返回来源详情/ }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
    }
  })
  test('第二页筛选结果经详情往返保留页码与行焦点', async ({ page }) => {
    const context = await (await page.request.get('/api/read/auxiliary-contracts/context')).json()
    for (let index = 1; index <= 12; index++) {
      const response = await page.request.post('/api/commands/auxiliary-contracts', {
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          requiredCapability: 'auxiliary-contract:write',
          commandId: `pagination-${index}`,
          baseVersion: null,
          action: 'save',
          draft: { kind: 'company_expense', name: `分页验收合同${index}`, category: '房租', counterparty: '分页出租单位', signDate: '2026-09-06', amount: 100, paymentCycle: '一次性' },
          attachments: { add: [], removeIds: [], restoreIds: [] },
        },
      })
      expect(response.ok(), await response.text()).toBe(true)
    }
    await page.goto('/contract/company-expense?search=分页验收&page=2&pageSize=10')
    const row = page.getByTestId('auxiliary-list').getByRole('link', { name: /^分页验收合同/ }).first()
    const name = (await row.textContent())!.trim()
    await row.click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText(name)
    await page.getByRole('button', { name: '返回来源', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByPlaceholder('搜索合同名称 / 编号 / 对方单位')).toHaveValue('分页验收')
    await expect(page.getByTestId('auxiliary-list').getByRole('link', { name, exact: true })).toBeFocused()
    await expect(page.getByText('当前筛选 · 正式合同 12 份')).toBeVisible()
  })
  test('从项目及分供方列表起步的完整来源链可以逐级返回', async ({ page }) => {
    for (const [list, name, backLabel] of [
      ['/project?search=中央正式施工项目', '中央正式施工项目', '返回项目列表'],
      ['/base/supplier', '中央正式劳务分供方', '返回分供方列表'],
    ]) {
      await page.goto(list!)
      await page.getByRole('link', { name, exact: true }).click()
      await expect(page.getByTestId('auxiliary-journey')).toBeVisible()
      const source = new URL(page.url()).searchParams.get('returnTo')
      expect(source).toBeTruthy()
      await page.getByTestId('auxiliary-journey').getByRole('link', { name: '查看其他支出合同' }).click()
      await page.getByRole('link', { name: '验收检测服务合同', exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
      await page.getByRole('button', { name: '返回来源', exact: true }).click()
      await page.getByRole('link', { name: '返回来源', exact: true }).click()
      await expect(page.getByTestId('auxiliary-journey').getByRole('link')).toBeFocused()
      await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe(source)
      await page.getByRole('link', { name: backLabel, exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname).toBe(new URL(list!, 'https://crm.test').pathname)
      await expect(page).toHaveURL(url => url.searchParams.get('search') === new URL(list!, 'https://crm.test').searchParams.get('search'))
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
    }
  })
  test('读取失败可重试，无权限、错误身份与筛选空态不混淆', async ({ page }) => {
    const readURL = '**/api/read/auxiliary-contracts?**'
    await page.route(readURL, route => route.abort('failed'))
    await page.goto('/contract/company-expense')
    await expect(page.getByText('合同服务暂时不可用，请重试', { exact: true })).toBeVisible()
    await expect(page.getByText('暂无公司支出合同', { exact: true })).toHaveCount(0)
    await page.unroute(readURL)
    await page.getByRole('button', { name: '重新加载', exact: true }).click()
    await page.getByRole('link', { name: '办公室租赁合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
    const url = page.url()
    await page.goto(url.replace('/company-expense/', '/other-expense/'))
    await expect(page.getByText('合同类型或数据来源不匹配', { exact: true })).toBeVisible()
    await page.goto('/contract/company-expense/unknown-id?origin=real')
    await expect(page.getByText('合同不存在或已删除', { exact: true })).toBeVisible()
    await page.goto('/contract/company-expense?search=无匹配合同')
    await expect(page.getByRole('status', { name: '没有符合条件的合同' })).toBeVisible()
    await page.getByRole('button', { name: '清除筛选', exact: true }).first().click()
    await expect(page.getByRole('link', { name: '办公室租赁合同', exact: true })).toBeVisible()
    await page.route('**/api/read/auxiliary-contracts/**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ data: { code: 'forbidden', message: '无合同查看权限', retryable: false, fieldErrors: {}, traceId: null } }) }))
    await page.goto(url)
    await expect(page.getByText('无合同查看权限', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '编辑合同' })).toHaveCount(0)
  })
  test('四档实际视口覆盖列表详情表单、局部滚动、菜单与离开确认', async ({ page }) => {
    test.setTimeout(180000)
    const evidence = 'docs/design/evidence/issue-330'
    if (process.env.RUIHANG_CAPTURE_EVIDENCE === '1')
      await mkdir(evidence, { recursive: true })
    for (const [kind, name] of [['other-expense', '验收检测服务合同'], ['company-expense', '办公室租赁合同']] as const) {
      for (const width of RESPONSIVE_WIDTHS) {
        const capture = async (state: string) => {
          await expectNoPageOverflow(page, `${kind} ${state} ${width}`)
          if (process.env.RUIHANG_CAPTURE_EVIDENCE === '1')
            await page.screenshot({ path: `${evidence}/${kind}-${state}-${width}.png` })
        }
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/contract/${kind}`)
        const link = page.getByRole('link', { name, exact: true })
        await expect(link).toBeVisible()
        await capture('list')
        await expectLocalHorizontalScroll(page.locator('[data-ui="kit-table"] .vxe-table--scroll-x-handle').first(), `${kind} 列表`)
        const menuTrigger = page.getByRole('button', { name: `${name}操作`, exact: true })
        await menuTrigger.focus()
        await page.keyboard.press('Enter')
        await expectEscapeReturnsFocus(page, page.getByRole('menu'), menuTrigger, '行操作菜单')
        await link.click()
        await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
        await capture('detail')
        await page.getByRole('button', { name: '收票登记', exact: true }).click()
        if (width === 390)
          await expectLocalHorizontalScroll(page.getByRole('region', { name: '合同关联事实表' }), '关联事实表')
        await page.getByRole('button', { name: '编辑合同', exact: true }).click()
        await expect(page.getByLabel('合同名称 *')).toHaveValue(name)
        if (kind === 'other-expense') {
          await expect(page.getByRole('combobox', { name: '检索项目' })).toHaveValue('中央正式施工项目')
          await expect(page.getByRole('combobox', { name: '检索分供方' })).toHaveValue('中央正式劳务分供方')
        }
        await capture('form')
        await page.getByLabel('合同名称 *').fill(`${name}（未保存）`)
        const cancel = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '取消', exact: true })
        await cancel.click()
        const dialog = page.getByRole('dialog', { name: '放弃修改' })
        await expectOverlayAboveShell(dialog, '离开确认')
        await expectEscapeReturnsFocus(page, dialog, cancel, '离开确认')
        await expect(page.getByLabel('合同名称 *')).toHaveValue(`${name}（未保存）`)
        await cancel.click()
        await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
        await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
        await expect(page.getByRole('button', { name: '收票登记', exact: true })).toHaveAttribute('aria-current', 'page')
      }
    }
  })
})

async function withFormalAuxiliary(page: Page, work: (formal: { origin: string, directory: string, request: (path: string, data?: unknown) => ReturnType<Page['request']['fetch']> }) => Promise<void>) {
  const base = resolve('.tmp/opt-02/auxiliary-ui')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/formal-`)
  const origin = 'http://127.0.0.1:3130'
  const code = 'auxiliary-synthetic-verification-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const accessCodeHash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  const child: ChildProcess = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'auxiliary-browser', CRM_OWNER_ID: 'auxiliary-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: accessCodeHash, NITRO_HOST: '127.0.0.1', NITRO_PORT: '3130', PORT: '3130', CRM_BACKUP_STAGING_DIRECTORY: '', CRM_BACKUP_DIRECTORY: '', CRM_BACKUP_OFFLINE_DIRECTORY: '', CRM_BACKUP_RESTORE_DIRECTORY: '' } })
  let logs = ''
  child.stdout!.on('data', data => logs += String(data))
  child.stderr!.on('data', data => logs += String(data))
  const request = (path: string, data?: unknown) => page.request.fetch(`${origin}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: origin }, ...(data === undefined ? {} : { data }) })
  try {
    await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
    await expect.poll(async () => {
      if (child.exitCode !== null)
        throw new Error(logs)
      try {
        return (await fetch(`${origin}/api/auth/status`)).status
      }
      catch { return 0 }
    }, { timeout: 30_000 }).toBe(200)
    await page.goto(`${origin}/contract/company-expense/form`)
    await page.getByLabel('本机访问码').fill(code)
    await page.getByRole('button', { name: '进入工作区', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    const signer = await request('/api/commands/our-signatories', { workspaceId: 'auxiliary-browser', actorId: 'auxiliary-owner', requiredCapability: 'our-signatory:write', commandId: 'auxiliary-browser-signer', baseVersion: null, draft: { name: '真实合成签约主体', taxNo: 'AUXILIARY-BROWSER-ONLY', registeredAddress: null, legalRepresentative: null, verificationNote: '本次合成核验', status: 'active' } })
    expect(signer.ok(), await signer.text()).toBe(true)
    await page.goto(`${origin}/contract/company-expense/form`)
    await work({ origin, directory, request })
  }
  finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  }
}

test('正式 Auxiliary 新建公司合同失响应后仅核对同原号，唯一记录、真实原件与审计回读，已保存GET失败仅重试读取', async ({ page }) => {
  test.setTimeout(180000)
  await withFormalAuxiliary(page, async ({ origin, request }) => {
    await page.getByLabel('合同名称 *').fill('重试验收合同')
    await page.getByLabel('对方单位 *').fill('验收出租单位')
    await page.getByLabel('签订日期 *').fill('2026-10-07')
    await page.getByLabel('合同金额 *').fill('1060')
    const signatory = page.getByRole('combobox', { name: '搜索真实签约主体', exact: true })
    await signatory.fill('真实合成')
    await page.getByRole('option', { name: /真实合成签约主体/ }).click()
    const bytes = Buffer.from('验收用实际持久化原件')
    await page.locator('input[type=file]').setInputFiles({ name: '验收合同说明.txt', mimeType: 'text/plain', buffer: bytes })
    await expect(page.getByText('验收合同说明.txt', { exact: true })).toBeVisible()
    const commands: string[] = []
    let loseResponse = true
    await page.route('**/api/commands/auxiliary-contracts', async (route) => {
      commands.push(route.request().postDataJSON().commandId)
      const response = await route.fetch()
      if (loseResponse) {
        loseResponse = false
        await route.abort('failed')
      }
      else {
        await route.fulfill({ response })
      }
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeVisible()
    await expect.poll(() => commands.length).toBe(1)
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeEnabled()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('重试验收合同')
    const originalKey = commands[0]!
    const originalDescriptor = await page.evaluate(() => Object.entries(sessionStorage).find(([key]) => key.startsWith('crm:form-command:v1:auxiliary-contract:'))?.[1])
    expect(JSON.parse(originalDescriptor!).commandId).toBe(originalKey)
    expect(Object.keys(JSON.parse(originalDescriptor!)).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
    expect(originalDescriptor).not.toContain(bytes.toString('base64'))
    const resolvedKeys: string[] = []
    await page.route('**/api/commands/auxiliary-contracts/resolve', async (route) => {
      resolvedKeys.push(route.request().postDataJSON().commandId)
      await route.continue()
    })
    await page.getByRole('button', { name: '核对原提交结果', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toHaveCount(0)
    expect(commands).toEqual([originalKey])
    expect(resolvedKeys).toEqual([originalKey])
    const list = await request('/api/read/auxiliary-contracts?kind=company_expense&search=重试验收合同')
    expect(list.ok(), await list.text()).toBe(true)
    const record = (await list.json()).items
    expect(record).toHaveLength(1)
    expect(record[0].audit).toMatchObject({ createdBy: 'auxiliary-owner', updatedBy: 'auxiliary-owner' })
    const id = record[0].id
    await page.goto(`${origin}/contract/company-expense/${id}?origin=real`)
    await expect(page.getByTestId('auxiliary-detail')).toContainText('验收合同说明.txt')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载', exact: true }).click()
    const downloaded = await download
    expect(await readFile((await downloaded.path())!)).toEqual(bytes)
    await page.getByRole('button', { name: '编辑合同', exact: true }).click()
    await page.getByLabel('合同名称 *').fill('原目标已保存后读失败')
    let getFails = true
    await page.route(`**/api/read/auxiliary-contracts/${id}?**`, async (route) => {
      if (getFails)
        await route.abort('failed')
      else await route.continue()
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toBeEnabled()
    const writes = commands.length
    const resolves = resolvedKeys.length
    getFails = false
    await page.getByRole('button', { name: '核对原提交结果', exact: true }).click()
    await expect(page.getByRole('button', { name: '核对原提交结果', exact: true })).toHaveCount(0)
    expect(commands.length).toBe(writes)
    expect(resolvedKeys.length).toBe(resolves)
    await page.goto(`${origin}/contract/company-expense/${id}?origin=real`)
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原目标已保存后读失败')
  })
})

test('正式 Auxiliary 整页真实工程动态选择及重开，完整两类Native原图/补链/原件同次采用和危险整批恢复', async ({ page }, info) => {
  test.setTimeout(180000)
  await withFormalAuxiliary(page, async ({ origin, directory, request }) => {
    const base = { workspaceId: 'auxiliary-browser', actorId: 'auxiliary-owner', baseVersion: null, action: 'save', attachments: {} }
    const create = async (path: string, body: unknown) => {
      const response = await request(path, body)
      expect(response.ok(), await response.text()).toBe(true)
      return response.json()
    }
    const customer = await create('/api/commands/customers', { ...base, commandId: 'aux-ui-customer', requiredCapability: 'customer:write', draft: { name: '实际辅助合同甲方', contact: '合成联系人' } })
    const project = await create('/api/commands/projects', { ...base, commandId: 'aux-ui-project', requiredCapability: 'project:write', draft: { name: '实际工程名称', customerId: customer.id, manager: '合成负责人' } })
    const supplier = await create('/api/commands/suppliers', { ...base, commandId: 'aux-ui-supplier', requiredCapability: 'supplier:write', draft: { name: '实际检测分供方', supplierCategory: '其他', contact: '合成联系人' } })
    const context = await (await request('/api/read/auxiliary-contracts/context')).json()
    const signer = context.ourSignatories.find((row: { draft: { name: string } }) => row.draft.name === '真实合成签约主体')
    for (const no of ['AUX-MAIN-A', 'AUX-MAIN-B'])
      await create('/api/commands/construction-contracts', { ...base, commandId: `aux-ui-${no}`, requiredCapability: 'construction-contract:write', draft: { name: '同一工程实际施工合同', no, projectId: project.id, customerId: customer.id, signDate: '2026-10-07', content: '真实上游约定', amount: 0, taxRate: 0, ourSignatoryId: signer.id, ourSignatoryVersion: signer.version, managementFeeAmount: 0, managementFeeBasis: '明确零配置' } })
    await page.goto(`${origin}/contract/other-expense/form`)
    const engineering = page.getByRole('combobox', { name: '搜索工程及施工主合同名称 / 编号', exact: true })
    await expect(engineering).toHaveValue('')
    await engineering.fill('AUX-MAIN-B')
    await page.getByRole('option', { name: /AUX-MAIN-B/ }).click()
    const label = await engineering.inputValue()
    expect(label).toContain('实际工程名称')
    expect(label).toContain('AUX-MAIN-B')
    await engineering.click()
    const selected = page.getByRole('option', { name: /AUX-MAIN-B/ })
    await expect(selected).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(engineering).toBeFocused()
    await expect(engineering).toHaveValue(label)
    await page.getByRole('combobox', { name: '检索分供方', exact: true }).fill('实际检测')
    await page.getByRole('option', { name: /实际检测分供方/ }).click()
    await page.getByRole('combobox', { name: '搜索真实签约主体', exact: true }).fill('真实合成')
    await page.getByRole('option', { name: /真实合成签约主体/ }).click()
    await page.getByLabel('合同名称 *').fill('实际工程必选辅助合同')
    await page.getByLabel('合同金额 *').fill('0')
    let sent: Record<string, unknown> | null = null
    await page.route('**/api/commands/auxiliary-contracts', async (route) => {
      sent = route.request().postDataJSON()
      await route.continue()
    })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存草稿', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('实际工程必选辅助合同')
    const details = await (await request('/api/read/auxiliary-contracts?kind=other_expense')).json()
    expect(details.items).toHaveLength(1)
    expect(sent).toMatchObject({ draft: { projectId: project.id, supplierId: supplier.id, amount: 0 }, constructionMain: { projectId: project.id } })
    const record = await (await request(`/api/read/auxiliary-contracts/${details.items[0].id}?kind=other_expense&origin=real`)).json()
    const currentContext = await (await request('/api/read/auxiliary-contracts/context')).json()
    expect(record.constructionMain.id).toBe(currentContext.constructionMains.find((row: { no: string }) => row.no === 'AUX-MAIN-B').id)
    await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expectNoPageOverflow(page, `正式辅助合同详情 ${width}`)
      await page.getByRole('button', { name: '编辑合同', exact: true }).click()
      await expect(engineering).toHaveValue(label)
      await expectNoPageOverflow(page, `正式辅助合同表单 ${width}`)
      await page.getByLabel('合同名称 *').fill(`实际工程必选辅助合同（${width}未保存）`)
      const cancel = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '取消', exact: true })
      await cancel.click()
      const dialog = page.getByRole('dialog', { name: '放弃修改' })
      await expectOverlayAboveShell(dialog, `正式辅助合同确认 ${width}`)
      await expectEscapeReturnsFocus(page, dialog, cancel, `正式辅助合同确认 ${width}`)
      await cancel.click()
      await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
      if (width === 390 || width === 1440)
        await page.screenshot({ path: info.outputPath(`auxiliary-detail-${width}.png`), fullPage: true })
    }
    const native = await createMemoryDb()
    await runMigrations(native)
    await native.execute('INSERT INTO projects(id,name) VALUES (\'native-aux-ui-project\',\'原工程名称\')')
    await native.execute('INSERT INTO suppliers(id,name) VALUES (\'native-aux-ui-supplier\',\'原检测分供方\')')
    await native.execute('INSERT INTO contracts(id,no,name,kind,project_id,supplier_id,other_expense_kind,amount,status) VALUES (\'native-aux-ui-head\',\'NATIVE-AUX\',\'原完整检测合同\',\'其他支出\',\'native-aux-ui-project\',\'native-aux-ui-supplier\',\'检测服务\',NULL,\'已签订\')')
    await native.execute('INSERT INTO company_expense_contracts(id,no,name,category,counterparty,amount,status) VALUES (\'native-aux-ui-head\',\'NATIVE-COMPANY\',\'原完整公司合同\',\'房租\',\'原出租单位\',0,\'履约中\')')
    await native.execute('INSERT INTO contract_supplements(id,contract_id,name,amount,status) VALUES (\'native-aux-ui-supp\',\'native-aux-ui-head\',\'原完整检测增补\',0,\'有效\')')
    await native.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type) VALUES (\'native-aux-ui-file\',\'contract_supplement\',\'native-aux-ui-supp\',\'原完整增补原件.txt\',\'D:/原件/原完整增补原件.txt\',3,\'text/plain\')')
    await native.execute('INSERT INTO operation_logs(id,table_name,record_id,action,after_data) VALUES (\'native-aux-ui-audit\',\'contracts\',\'native-aux-ui-head\',\'update\',?)', ['{"原审计":"完整保留"}'])
    const sourceBytes = Buffer.from(native.raw.export())
    native.close()
    const sourcePath = join(directory, 'explicit-native-auxiliary.sqlite')
    await writeFile(sourcePath, sourceBytes, { flag: 'wx' })
    await page.goto(`${origin}/contract/other-expense`)
    await page.getByText('完整 Native 辅助合同迁入与受保护恢复', { exact: true }).click()
    await page.getByLabel('完整辅助合同来源文件').setInputFiles(sourcePath)
    await expect(page.getByLabel('采用native-aux-ui-project')).toBeVisible()
    await page.getByLabel('采用native-aux-ui-project').selectOption(`${project.id}@${project.version}`)
    await page.getByLabel('采用native-aux-ui-supplier').selectOption(`${supplier.id}@${supplier.version}`)
    await page.getByLabel('补齐native-aux-ui-file').setInputFiles({ name: '原完整增补原件.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
    await page.getByRole('button', { name: '采用完整辅助合同原图', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '采用完整原图', exact: true }).click()
    await expect(page.getByRole('link', { name: '原完整检测合同', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '原完整检测合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原完整增补原件.txt')
    await page.getByRole('button', { name: '增补合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原完整检测增补')
    await page.goto(`${origin}/contract/company-expense`)
    await page.getByRole('link', { name: '原完整公司合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('原出租单位')
    const invalid = await request('/api/commands/auxiliary-contracts', { ...base, requiredCapability: 'auxiliary-contract:write', commandId: 'aux-ui-later-intent', id: 'native-aux-ui-head', baseVersion: '0', draft: { kind: 'other_expense' }, attachments: {} })
    expect(invalid.status()).toBe(409)
    await page.goto(`${origin}/contract/other-expense`)
    await page.getByText('完整 Native 辅助合同迁入与受保护恢复', { exact: true }).click()
    await page.getByRole('button', { name: '受保护整批恢复', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '核验并退役采用', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: '危险恢复拒绝' })).toBeVisible()
    expect(await readFile(sourcePath)).toEqual(sourceBytes)
  })
})
