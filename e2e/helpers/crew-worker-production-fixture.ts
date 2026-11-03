import type { Page, TestInfo } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from '@playwright/test'
import { isolatedInheritedEnvironment, isolatedServerEntry } from '../../scripts/e2e-isolation'

export async function createCrewWorkerProductionFixture(page: Page, info: TestInfo, options: { serverEntry?: string, requireIsolated?: boolean } = {}) {
  if (options.requireIsolated && !options.serverEntry)
    throw new Error('正式导入验收必须明确指定独立构建入口')
  const entry = options.serverEntry ? isolatedServerEntry(process.cwd(), options.serverEntry) : '.output/server/index.mjs'
  const base = resolve('.tmp/a03-crew-worker-browser')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/synthetic-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'crew-worker-synthetic-access-only'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  async function stop() {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    child = null
  }
  async function start() {
    const inherited = isolatedInheritedEnvironment(process.env)
    child = spawn(process.execPath, [entry], { cwd: resolve('.'), windowsHide: true, env: { ...inherited, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'crew-browser-workspace', CRM_OWNER_ID: 'crew-browser-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
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
    await page.goto(`${origin}/base/worker`)
    await expect(page.getByLabel('本机访问码')).toBeVisible()
    await page.getByLabel('本机访问码').fill(code)
    await page.getByLabel('本机访问码').press('Tab')
    await expect(page.getByRole('button', { name: '进入工作区', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '退出本机登录' })).toBeVisible()
    await expect(page).toHaveURL(`${origin}/base/customer`)
  }
  async function request(path: string, options: { method?: string, data?: unknown } = {}) {
    return page.request.fetch(`${origin}${path}`, { ...options, headers: { Origin: origin } })
  }
  async function cleanup() {
    await stop()
    if (logs)
      await info.attach('production-crew-worker-log', { body: logs, contentType: 'text/plain' })
  }
  return { directory, origin, start, stop, login, request, cleanup }
}
