import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'

test.skip(process.env.CRM_PRODUCTION_ACCEPTANCE !== '1', '需先构建，只连接本次合成目录与临时本机端口')
test('客户原件公开备份、失响应原键、离线副本与隔离冷恢复保持一致', async ({ page }, info) => {
  test.setTimeout(150_000)
  const base = resolve('.codex-tmp/issue-451-browser')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(`${base}/synthetic-`)
  const directories = Object.fromEntries(['source', 'staging', 'nas', 'offline', 'restore'].map(name => [name, join(root, name)]))
  for (const directory of Object.values(directories)) await mkdir(directory)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'backup-synthetic-access-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    child = null
  }
  async function start(directory = directories.source!, backupEnabled = true) {
    child = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: resolve('.'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'backup-browser', CRM_OWNER_ID: 'backup-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port), CRM_BACKUP_STAGING_DIRECTORY: backupEnabled ? directories.staging : '', CRM_BACKUP_DIRECTORY: backupEnabled ? directories.nas : '', CRM_BACKUP_OFFLINE_DIRECTORY: backupEnabled ? directories.offline : '', CRM_BACKUP_RESTORE_DIRECTORY: backupEnabled ? directories.restore : '' },
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
    await expect(page.getByLabel('本机访问码')).toBeVisible()
    await page.getByLabel('本机访问码').fill(code)
    await page.getByRole('button', { name: '进入工作区', exact: true }).click()
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(page).toHaveURL(`${origin}/base/customer`)
  }
  const request = (path: string, data?: unknown) => page.request.fetch(`${origin}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: origin }, ...(data === undefined ? {} : { data }) })
  const state = async () => (await request('/api/production/backup/status')).json()
  try {
    await start()
    await page.goto(`${origin}/base/customer`)
    await login()
    await expect.poll(async () => (await state()).running).toBe(false)
    const bytes = Buffer.from('只用于备份隔离恢复验证的客户原件。')
    const command = { commandId: 'backup-customer-original', workspaceId: 'backup-browser', actorId: 'backup-owner', requiredCapability: 'customer:write', action: 'save', baseVersion: null, draft: { name: '隔离恢复客户', contact: '合成人', aliases: ['备份测试'] }, attachments: { add: [{ fileName: '原件说明.txt', mimeType: 'text/plain', fileSize: bytes.length, contentBase64: bytes.toString('base64') }] } }
    const created = await request('/api/commands/customers', command)
    expect(created.status()).toBe(200)
    const customer = await created.json()
    await page.getByRole('button', { name: '备份与恢复', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '备份与恢复' })
    await expect(dialog).toBeVisible()
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await expect.poll(() => dialog.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(Math.min(640, width - 24) - 1)
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      if ([390, 1440].includes(width))
        await page.screenshot({ path: info.outputPath(`backup-${width}.png`), fullPage: true })
    }
    let originalBackupCommand = ''
    let backupId = ''
    await page.route('**/api/commands/production-backups', async (route) => {
      originalBackupCommand = route.request().postDataJSON().commandId
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      const result = await response.json()
      expect(result.state).toBe('succeeded')
      backupId = result.packageId
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic-lost-backup-response' }) })
    }, { times: 1 })
    await dialog.getByRole('button', { name: '立即备份', exact: true }).click()
    await expect.poll(() => backupId).toBeTruthy()
    await expect(dialog.getByRole('button', { name: '核对原操作' })).toBeEnabled()
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain(bytes.toString('base64'))
    await stop()
    await start()
    await page.reload()
    await login()
    await page.getByRole('button', { name: '备份与恢复', exact: true }).click()
    await dialog.getByRole('button', { name: '核对原操作' }).click()
    await expect(dialog.getByRole('button', { name: '立即备份', exact: true })).toBeEnabled()
    const afterRetry = await state()
    expect(afterRetry.latest).toMatchObject({ commandId: originalBackupCommand, packageId: backupId, state: 'succeeded' })
    expect(afterRetry.recent.filter((run: { commandId: string }) => run.commandId === originalBackupCommand)).toHaveLength(1)
    await dialog.getByRole('button', { name: '复制到离线介质' }).click()
    await expect.poll(async () => (await state()).offline?.packageId).toBe(backupId)
    await expect(dialog.getByRole('button', { name: '验证隔离恢复' })).toBeEnabled()
    await dialog.getByRole('button', { name: '验证隔离恢复' }).click()
    await expect.poll(async () => (await state()).baseline?.packageId).toBe(backupId)
    const protectedState = await state()
    expect(protectedState.offline.capturedAt).toBe(protectedState.latest.capturedAt)
    const proof = protectedState.recent.find((run: { action: string, state: string }) => run.action === 'verify-restore' && run.state === 'succeeded')
    expect(await readFile(join(directories.nas!, backupId, 'data.sqlite'))).toEqual(await readFile(join(directories.offline!, backupId, 'data.sqlite')))
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('button', { name: '备份与恢复', exact: true })).toBeFocused()
    await rename(directories.nas!, `${directories.nas}-removed`)
    const failed = await request('/api/commands/production-backups', { commandId: 'missing-media', action: 'backup', sourceBackupId: null })
    expect(await failed.json()).toMatchObject({ state: 'failed' })
    expect((await state()).latest.packageId).toBe(backupId)
    await rename(`${directories.nas}-removed`, directories.nas!)
    expect((await request('/api/commands/production-backups', { commandId: 'bad-source', action: 'backup', sourceBackupId: null, origin: 'demo' })).status()).not.toBe(200)
    expect((await request('/api/production/backup/status?origin=demo')).status()).toBe(403)
    await stop()
    await start(join(directories.restore!, proof.commandId), false)
    await page.reload()
    await login()
    const restored = await (await request(`/api/read/customers/${customer.id}/form`)).json()
    expect(restored).toMatchObject({ version: '1', draft: { id: customer.id, name: command.draft.name, aliases: ['备份测试'] } })
    expect((await (await request(`/api/read/customer-commands/${command.commandId}`)).json()).result).toEqual(customer)
    expect(await (await request(`/api/read/customers/${customer.id}/audit`)).json()).toMatchObject([{ commandId: command.commandId, actorId: 'backup-owner' }])
    const original = await request(`/api/read/customers/${customer.id}/files/${customer.attachmentIds[0]}`)
    expect(await original.body()).toEqual(bytes)
    expect(original.headers()['x-content-sha256']).toBe(createHash('sha256').update(bytes).digest('hex'))
    await page.goto(`${origin}/base/customer/${customer.id}?origin=real`)
    await expect(page.getByRole('heading', { name: command.draft.name, exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('restored-customer.png'), fullPage: true })
    expect(errors).toEqual([])
  }
  finally {
    await stop()
    await writeFile(join(root, 'server.log'), logs, 'utf8')
  }
})
