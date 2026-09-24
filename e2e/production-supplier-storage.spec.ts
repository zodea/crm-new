import type { ChildProcess } from 'node:child_process'
import type { SupplierCredentialSnapshot } from '../app/lib/supplier/credential-contract'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '需先构建，在专属合成目录验证，不连接用户数据')
test('分供方主档、证照原件与人工核验失响应后独立重启，以原键恢复且不重复提交', async ({ page }, info) => {
  test.setTimeout(120_000)
  const base = resolve('.codex-tmp/issue-453-browser')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'supplier-synthetic-access-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const pageErrors: string[] = []
  const unavailableRequests: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('dialog', dialog => void dialog.accept())
  page.on('request', (request) => {
    if (request.url().includes('/api/read/auxiliary-contracts'))
      unavailableRequests.push(request.url())
  })
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    child = null
  }
  async function start() {
    child = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: resolve('.'),
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'supplier-browser', CRM_OWNER_ID: 'supplier-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', data => logs += String(data))
    child.stderr!.on('data', data => logs += String(data))
    await expect.poll(async () => {
      if (child?.exitCode !== null)
        throw new Error(logs)
      try {
        return (await fetch(`${origin}/api/auth/status`)).status
      }
      catch {
        return 0
      }
    }, { timeout: 30_000 }).toBe(200)
  }
  async function login() {
    await page.getByLabel('本机访问码').fill(code)
    await page.getByLabel('本机访问码').press('Tab')
    await expect(page.getByRole('button', { name: '进入工作区', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(page).toHaveURL(`${origin}/base/customer`)
  }
  async function viewports(state: string) {
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      if (state === 'recovered-credential') {
        const originalDownload = page.getByRole('button', { name: '下载 仅用于合成验收的营业执照.png', exact: true })
        await originalDownload.scrollIntoViewIfNeeded()
        await expect(originalDownload).toBeVisible()
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if ([390, 1440].includes(width))
        await page.screenshot({ path: info.outputPath(`${state}-${width}.png`), fullPage: true })
    }
  }
  try {
    await start()
    await page.goto(`${origin}/base/supplier`)
    await login()
    await page.goto(`${origin}/base/supplier/form?category=${encodeURIComponent('材料供应商')}`)
    await page.getByLabel('公司全称 *', { exact: true }).fill('分供方磁盘原键验收')
    await page.getByLabel('主要联系人 *', { exact: true }).fill('合成联系人')
    await page.getByLabel('统一社会信用代码', { exact: true }).fill('SYNTHETIC-453-TAX')
    let supplierId = ''
    let masterCommand = ''
    await page.route('**/api/commands/suppliers', async (route) => {
      masterCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      supplierId = (await response.json()).id
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-master-response-lost' }) })
    }, { times: 1 })
    await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
    await expect.poll(() => supplierId).toBeTruthy()
    await expect(page.getByLabel('公司全称 *', { exact: true })).toHaveValue('分供方磁盘原键验收')
    expect(await page.evaluate(() => Object.values({ ...sessionStorage }).filter(value => typeof value === 'string' && value.includes('分供方磁盘原键验收')))).toEqual([])
    await stop()
    await start()
    await page.reload()
    await login()
    await page.goto(`${origin}/base/supplier`)
    await page.getByRole('button', { name: '排序', exact: true }).click()
    const sortSelect = page.getByRole('combobox', { name: '排序方式' })
    await expect.poll(() => sortSelect.locator('option[value="projectCount-asc"]').evaluate(element => (element as HTMLOptionElement).disabled)).toBe(true)
    await expect.poll(() => sortSelect.locator('option[value="paymentAmount-desc"]').evaluate(element => (element as HTMLOptionElement).disabled)).toBe(true)
    await sortSelect.press('End')
    await expect(sortSelect).toHaveValue('category-asc')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '筛选合作项目数', exact: true })).toHaveCount(0)
    await page.getByRole('link', { name: '核对分供方提交 1' }).click()
    await expect(page.getByText('已核对上次提交：保存成功，现已读取磁盘中的分供方。')).toBeVisible()
    await expect(page.getByLabel('公司全称 *', { exact: true })).toHaveValue('分供方磁盘原键验收')
    await page.goto(`${origin}/base/supplier/${supplierId}?origin=real`)
    await page.getByRole('tab', { name: '支出合同', exact: true }).click()
    await expect(page.getByText('此项业务事实尚未接入', { exact: true })).toBeVisible()
    expect(unavailableRequests).toEqual([])
    await viewports('unavailable-facts')
    await page.getByRole('link', { name: '证照附件', exact: true }).click()
    await page.getByRole('button', { name: '上传原件', exact: true }).click()
    let editor = page.getByRole('dialog', { name: '上传证照原件' })
    await editor.getByRole('button', { name: '取消', exact: true }).press('Enter')
    await expect(page.getByRole('button', { name: '上传原件', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '上传原件', exact: true }).click()
    editor = page.getByRole('dialog', { name: '上传证照原件' })
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=', 'base64')
    await editor.getByLabel('选择原件').setInputFiles({ name: '仅用于合成验收的营业执照.png', mimeType: 'image/png', buffer: bytes })
    await editor.getByRole('combobox', { name: '证照类别', exact: true }).selectOption('营业执照')
    await editor.getByLabel('长期有效', { exact: true }).check()
    let credentialCommand = ''
    await page.route('**/api/commands/supplier-credentials', async (route) => {
      credentialCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-credential-response-lost' }) })
    }, { times: 1 })
    await editor.getByRole('button', { name: '保存原件', exact: true }).click()
    await expect(editor.getByRole('button', { name: '恢复原提交', exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain(bytes.toString('base64'))
    await stop()
    await start()
    await page.reload()
    await login()
    await page.goto(`${origin}/base/supplier/credential/${supplierId}?origin=real`)
    await expect(page.getByText('已核对原证照提交：保存成功，现已重新读取原件与资料。')).toBeVisible()
    const snapshot: SupplierCredentialSnapshot = await (await page.request.get(`${origin}/api/read/supplier-credentials/${supplierId}?origin=real`)).json()
    expect(snapshot.credentials).toHaveLength(1)
    const original = snapshot.credentials[0]!
    const file = await (await page.request.get(`${origin}/api/read/supplier-credentials/${supplierId}/files/${original.file!.id}?origin=real&credentialId=${original.id}`)).json()
    expect(Buffer.from(file.payloadBase64, 'base64')).toEqual(bytes)
    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载 仅用于合成验收的营业执照.png', exact: true }).click()
    const output = info.outputPath('downloaded-original.png')
    await (await download).saveAs(output)
    expect(await readFile(output)).toEqual(bytes)
    await viewports('recovered-credential')
    await page.getByRole('link', { name: '返回分供方详情', exact: true }).click()
    await expect(page.getByRole('heading', { name: '分供方磁盘原键验收', exact: true })).toBeVisible()
    await page.goto(`${origin}/base/supplier/form/${supplierId}?origin=real`)
    await page.getByRole('button', { name: '记录人工核验', exact: true }).click()
    const taxDialog = page.getByRole('dialog', { name: '记录纳税人核验结果' })
    await taxDialog.getByRole('combobox', { name: /^核验结果/ }).selectOption('not_found')
    await taxDialog.getByLabel('核验备注', { exact: true }).fill('合成核验：仅验证原键冷恢复')
    let taxpayerCommand = ''
    await page.route(`**/api/commands/suppliers/${supplierId}/taxpayer-verification`, async (route) => {
      taxpayerCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.ok(), await response.text()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-taxpayer-response-lost' }) })
    }, { times: 1 })
    await taxDialog.getByRole('button', { name: '保存核验记录', exact: true }).click()
    await expect(taxDialog.getByRole('button', { name: '恢复原提交', exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain('合成核验：仅验证原键冷恢复')
    await stop()
    await start()
    await page.reload()
    await login()
    await page.goto(`${origin}/base/supplier/form/${supplierId}?origin=real`)
    await expect(page.getByText('已核对上次提交：保存成功，现已读取磁盘中的分供方。')).toBeVisible()
    const savedTaxpayer = await (await page.request.get(`${origin}/api/read/suppliers/${supplierId}/form?origin=real`)).json()
    expect(savedTaxpayer.draft).toMatchObject({ taxpayerVerificationStatus: 'not_found', taxpayerVerificationNote: '合成核验：仅验证原键冷恢复', taxpayerType: '未核验' })
    const recoveredTaxpayerResponse = await page.request.post(`${origin}/api/commands/supplier-resolve`, { headers: { origin }, data: { commandId: taxpayerCommand } })
    expect(recoveredTaxpayerResponse.ok(), await recoveredTaxpayerResponse.text()).toBe(true)
    const recoveredTaxpayer = await recoveredTaxpayerResponse.json()
    expect(recoveredTaxpayer.result).toMatchObject({ commandId: taxpayerCommand, supplierId, verification: { taxpayerVerificationStatus: 'not_found' } })
    await page.goto(`${origin}/base/supplier?columnFilters=${encodeURIComponent(JSON.stringify({ ranges: { projectCount: { min: 0 } } }))}`)
    await expect(page.getByText('分供方列表加载失败', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '清除数值条件并重试', exact: true }).click()
    await expect(page.getByRole('link', { name: '分供方磁盘原键验收', exact: true })).toBeVisible()
    await viewports('unavailable-list')
    expect((await (await page.request.get(`${origin}/api/read/suppliers`)).json()).items).toHaveLength(1)
    expect(pageErrors).toEqual([])
    await writeFile(info.outputPath('verification.json'), `${JSON.stringify({ supplierId, masterCommand, credentialCommand, taxpayerCommand, credentialId: original.id, fileId: original.file!.id, sha256: file.sha256, coldRestarts: 3, supplierCount: 1, credentialCount: 1, unavailableNumericFilters: 'disabled; old link explicitly rejected, cleared by user', unavailableRequests, pageErrors }, null, 2)}\n`)
  }
  finally {
    await stop()
    await writeFile(resolve(directory, 'service.log'), logs)
  }
})
