import type { ChildProcess } from 'node:child_process'
import type { ProcessLibraryCreateCommand } from '../app/lib/schedule/process-library-contract'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '需先构建，在专属合成目录验证，不连接用户数据')
test('正式工序库完整页面保存、独立进程冷重开、原键和旧版本保持一致', async ({ page }, info) => {
  test.setTimeout(120_000)
  const base = resolve('.tmp/legacy-test-artifacts/issue-463-browser')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'process-library-synthetic-access-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
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
      env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'library-browser', CRM_OWNER_ID: 'library-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) },
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
  async function login() {
    await page.getByLabel('本机访问码').fill(code)
    await page.getByLabel('本机访问码').press('Tab')
    await expect(page.getByRole('button', { name: '进入工作区', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(page).toHaveURL(`${origin}/base/customer`)
  }
  async function detail(id: string) {
    const response = await page.request.get(`${origin}/api/read/process-libraries/${id}?origin=real`)
    expect(response.ok()).toBe(true)
    return response.json()
  }
  try {
    await start()
    await page.goto(`${origin}/schedule/process-library?origin=real`)
    await login()
    await page.goto(`${origin}/schedule/process-library/form?origin=real`)
    await expect(page.getByLabel('工序库编码 *')).toBeEnabled()
    await page.getByLabel('工序库编码 *').fill('LOCAL-463')
    await page.getByLabel('工序库名称 *').fill('本机完整工序库')
    await page.getByLabel('新工序 1名称').fill('施工交接')
    await page.getByLabel('施工交接默认工期').fill('3')
    await page.getByLabel('版本说明').fill('第一版完整保存')
    let command: ProcessLibraryCreateCommand | undefined
    await page.route('**/api/commands/process-libraries', async (route) => {
      command = route.request().postDataJSON()
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-response-lost' }) })
    }, { times: 1 })
    await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByLabel('版本说明')).toHaveValue('第一版完整保存')
    await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
    await expect(page.getByRole('heading', { name: '本机完整工序库 · v1', exact: true })).toBeVisible()
    const id = new URL(page.url()).pathname.split('/').at(-1)!
    const original = await detail(id)
    expect(original).toMatchObject({ version: 1, createdBy: 'library-owner', tasks: [{ name: '施工交接', durationDays: 3 }] })
    await stop()
    await start()
    await page.reload()
    await login()
    await page.goto(`${origin}/schedule/process-library/${id}?origin=real`)
    await expect(page.getByRole('heading', { name: '本机完整工序库 · v1', exact: true })).toBeVisible()
    expect(await detail(id)).toEqual(original)
    const repeated = await page.request.post(`${origin}/api/commands/process-libraries`, { headers: { Origin: origin }, data: command })
    expect(await repeated.json()).toMatchObject({ id, version: 1, commandId: command!.commandId })
    await page.getByRole('link', { name: '基于此版本新建', exact: true }).click()
    await expect(page.getByLabel('工序库编码 *')).toBeDisabled()
    await page.getByLabel('施工交接默认工期').fill('5')
    await page.getByLabel('版本说明').fill('第二版独立工期')
    await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
    await expect(page.getByRole('heading', { name: '本机完整工序库 · v2', exact: true })).toBeVisible()
    expect(await detail(id)).toEqual(original)
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if ([390, 1440].includes(width))
        await page.screenshot({ path: info.outputPath(`library-${width}.png`), fullPage: true })
    }
    const catalog = await (await page.request.get(`${origin}/api/read/process-libraries?origin=real`)).json()
    expect(catalog.seriesVersions).toEqual({ 'LOCAL-463': 2 })
    expect(catalog.libraries).toHaveLength(2)
    expect((await page.request.post(`${origin}/api/commands/payroll`, { headers: { Origin: origin }, data: {} })).status()).toBe(503)
    expect(pageErrors).toEqual([])
    await writeFile(info.outputPath('verification.json'), JSON.stringify({ versions: catalog.libraries.map((row: { id: string, version: number }) => ({ id: row.id, version: row.version })), coldRestart: true, originalCommandRecovered: true, oldVersionUnchanged: true, pageErrors }, null, 2))
  }
  finally {
    await stop()
    await writeFile(resolve(directory, 'service.log'), logs)
  }
})
