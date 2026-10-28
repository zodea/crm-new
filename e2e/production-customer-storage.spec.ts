import type { Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '需先构建，再在专属合成目录运行本机验收；不连接开发或用户数据')
test('公开客户保存、丢响应、独立进程重启、原件和删除恢复保持一致', async ({ page }) => {
  test.setTimeout(180_000)
  const root = resolve('.')
  const base = resolve('.tmp/a01-a03-production/customer')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const portProbe = createServer().listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>(resolve => portProbe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'customer-synthetic-access-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('dialog', dialog => void dialog.accept())
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
      cwd: root,
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'browser-verification', CRM_OWNER_ID: 'verification-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) },
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
      catch { return 0 }
    }, { timeout: 30_000 }).toBe(200)
  }
  async function login(target: Page) {
    await expect(target.getByLabel('本机访问码')).toBeVisible()
    await target.getByLabel('本机访问码').fill(code)
    await target.getByLabel('本机访问码').press('Tab')
    await expect(target.getByRole('button', { name: '进入工作区', exact: true })).toBeFocused()
    await target.keyboard.press('Enter')
    await expect(target.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(target).toHaveURL(`${origin}/base/customer`)
  }
  async function request(path: string, options?: { method?: string, data?: unknown }) {
    return page.request.fetch(`${origin}${path}`, { ...options, headers: { Origin: origin } })
  }
  try {
    await start()
    await page.clock.install()
    await page.goto(`${origin}/base/customer/form`)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await login(page)
    await page.getByRole('button', { name: '新建客户', exact: true }).first().click()
    await expect(page.getByLabel('客户名称 *')).toBeVisible()
    await page.getByLabel('客户名称 *').fill('独立重启验证客户')
    await page.getByLabel('联系人 *', { exact: true }).fill('合成联系人')
    const bytes = Buffer.from('客户原件：独立进程重启仍需字节一致。')
    await page.locator('input[type=file]').setInputFiles({ name: '原件核对.txt', mimeType: 'text/plain', buffer: bytes })
    await expect(page.getByText('原件核对.txt', { exact: true })).toBeVisible()
    await page.route('**/api/auth/status', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-status-unavailable' }) }), { times: 1 })
    await page.clock.fastForward(60_000)
    await expect(page.getByRole('heading', { name: '连接暂不可用', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '重新核对', exact: true }).click()
    await page.clock.resume()
    await expect(page.getByLabel('客户名称 *')).toHaveValue('独立重启验证客户')
    await expect(page.getByText('原件核对.txt', { exact: true })).toBeVisible()
    let originalCommand = ''
    let saved: { id: string, commandId: string, version: string, attachmentIds: string[] } | null = null
    await page.route('**/api/commands/customers', async (route) => {
      originalCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      saved = await response.json()
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-response-lost-after-commit' }) })
    }, { times: 1 })
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect.poll(() => saved?.id).toBeTruthy()
    await expect(page.getByLabel('客户名称 *')).toHaveValue('独立重启验证客户')
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain(bytes.toString('base64'))
    await stop()
    await start()
    await page.reload()
    await login(page)
    // Writing form routes are intentionally not general tab snapshots. The customer list exposes outstanding command keys.
    if (!await page.getByLabel('客户名称 *').isVisible()) {
      await page.goto(`${origin}/base/customer`)
      await page.getByRole('link', { name: '核对客户提交 1' }).click()
    }
    await expect(page.getByLabel('客户名称 *')).toHaveValue('独立重启验证客户')
    await expect(page.getByText('已核对上次提交：保存成功，现已读取磁盘中的客户。')).toBeVisible()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    const id = saved!.id
    expect((await (await request(`/api/read/customer-commands/${originalCommand}`)).json()).result).toEqual(saved)
    const form = await (await request(`/api/read/customers/${id}/form`)).json()
    expect(form).toMatchObject({ version: '1', draft: { id, name: '独立重启验证客户' } })
    const original = await request(`/api/read/customers/${id}/files/${saved!.attachmentIds[0]}`)
    expect(await original.body()).toEqual(bytes)
    expect(original.headers()['x-content-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(await (await request(`/api/read/customers/${id}/audit`)).json()).toMatchObject([{ actorId: 'verification-owner', action: 'create', commandId: originalCommand }])
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载原件 原件核对.txt' }).click()
    const downloaded = await downloadPromise
    const filePath = resolve(directory, 'downloaded-original.txt')
    await downloaded.saveAs(filePath)
    expect(await readFile(filePath)).toEqual(bytes)
    let failSavedRead = true
    await page.route(`**/api/read/customers/${id}/form`, async (route) => {
      if (failSavedRead)
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-post-save-read-unavailable' }) })
      else
        await route.continue()
    })
    await page.getByLabel('客户名称 *').fill('更正后重启验证客户')
    await page.getByRole('button', { name: '保存并提交', exact: true }).click()
    await expect.poll(async () => (await (await request(`/api/read/customers/${id}/form`)).json()).version).toBe('2')
    await expect(page.getByRole('status', { name: '原提交恢复' })).toContainText('已保存待刷新')
    const savedReadButton = page.getByRole('button', { name: '重新读取已保存记录', exact: true })
    await expect(savedReadButton).toBeEnabled()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await savedReadButton.focus()
      await expect(savedReadButton).toBeFocused()
    }
    await page.getByLabel('客户名称 *').fill('读取失败后继续编辑的稿件')
    await expect(page.getByRole('button', { name: '保存并提交', exact: true })).toBeDisabled()
    let repeatedSaves = 0
    await page.route('**/api/commands/customers', async (route) => {
      repeatedSaves++
      await route.continue()
    })
    await page.getByLabel('客户名称 *').press('Enter')
    expect((await (await request(`/api/read/customers/${id}/form`)).json()).version).toBe('2')
    expect(repeatedSaves).toBe(0)
    await page.unroute('**/api/commands/customers')
    failSavedRead = false
    await savedReadButton.press('Enter')
    await expect(page.getByRole('status', { name: '原提交恢复' })).toHaveCount(0)
    await expect(page.getByLabel('客户名称 *')).toHaveValue('读取失败后继续编辑的稿件')
    expect(await (await request(`/api/read/customers/${id}/form`)).json()).toMatchObject({ version: '2', draft: { name: '更正后重启验证客户' } })
    await page.goto(`${origin}/base/customer/${id}?origin=real`)
    await expect(page.getByRole('heading', { name: '更正后重启验证客户', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '删除客户', exact: true })).toBeEnabled()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.getByRole('button', { name: '删除客户', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('button', { name: '删除客户', exact: true })).toBeFocused()
    expect((await (await request(`/api/read/customers/${id}/lifecycle`)).json()).deletedAt).toBeNull()
    await page.getByRole('button', { name: '删除客户', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除客户', exact: true }).click()
    await expect(page.getByRole('button', { name: '恢复客户', exact: true })).toBeEnabled()
    await stop()
    await start()
    await page.reload()
    await login(page)
    await page.goto(`${origin}/base/customer`)
    await page.getByText('已删除客户（1）', { exact: true }).click()
    await page.getByRole('link', { name: '更正后重启验证客户', exact: true }).click()
    await page.getByRole('button', { name: '恢复客户', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '恢复客户', exact: true }).click()
    await expect(page.getByRole('link', { name: '编辑客户' })).toBeVisible()
    const restored = await (await request(`/api/read/customers/${id}/form`)).json()
    expect(restored.version).toBe('4')
    expect(await (await request(`/api/read/customers/${id}/files/${saved!.attachmentIds[0]}`)).body()).toEqual(bytes)
    expect((await (await request(`/api/read/customers/${id}/audit`)).json()).map((row: { action: string }) => row.action)).toEqual(['create', 'update', 'delete', 'restore'])
    expect((await request('/api/commands/payroll', { method: 'POST', data: {} })).status()).toBe(503)
    await page.getByRole('link', { name: '返回客户列表', exact: true }).click()
    await expect(page.getByText('已删除客户（0）', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '更正后重启验证客户', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '退出本机登录' }).click()
    await expect(page.getByLabel('本机访问码')).toBeVisible()
    expect((await request('/api/read/customers')).status()).toBe(401)
    expect(pageErrors).toEqual([])
    await stop()
    const db = new DatabaseSync(resolve(directory, 'ruihang.sqlite'), { readOnly: true })
    expect(db.prepare('SELECT COUNT(*) n FROM customers').get()?.n).toBe(1)
    db.close()
  }
  finally {
    await stop()
    await writeFile(resolve(directory, 'service.log'), logs)
    await writeFile(resolve(directory, 'verification.json'), JSON.stringify({ pageErrors, directory, origin }, null, 2))
  }
})
