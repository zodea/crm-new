import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { expect } from 'vitest'
import { spawnColdProcess } from './cold-process'

export async function processLibraryProductionProcess() {
  const base = resolve('.codex-tmp/issue-463-tests')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(`${base}/process-`)
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  const code = 'library-process-synthetic-code'
  const salt = '0123456789abcdef0123456789abcdef'
  const hash = `scrypt$${salt}$${scryptSync(code, Buffer.from(salt, 'hex'), 64).toString('hex')}`
  let child: ChildProcess | null = null
  let logs = ''
  let cookie = ''
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Origin': origin, 'Cookie': cookie, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return {
    directory,
    request,
    async start() {
      child = spawnColdProcess('production-process-library-server', { env: { ...process.env, CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: directory, CRM_WORKSPACE_ID: 'process-workspace', CRM_OWNER_ID: 'process-owner', CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout!.on('data', data => logs += String(data))
      child.stderr!.on('data', data => logs += String(data))
      await expect.poll(async () => {
        if (child?.exitCode !== null)
          throw new Error(logs)
        try {
          return (await request('/api/auth/status')).status
        }
        catch { return 0 }
      }, { timeout: 20000 }).toBe(200)
    },
    async login() {
      const response = await request('/api/auth/login', { accessCode: code })
      expect(response.status).toBe(200)
      cookie = response.headers.get('set-cookie')!.split(';')[0]!
    },
    async stop() {
      if (child && child.exitCode === null) {
        const exited = once(child, 'exit')
        child.kill()
        await exited
      }
      child = null
    },
  }
}
