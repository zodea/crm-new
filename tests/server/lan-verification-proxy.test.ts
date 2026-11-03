import type { Server } from 'node:http'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createVerificationProxy, verificationBackendEnvironment } from '../../scripts/lan-verification-proxy.mjs'

const servers: Server[] = []

it('验证入口只使用隔离备份目录，不继承正式环境或伪造离线介质', () => {
  const env = verificationBackendEnvironment({ systemRoot: 'system', path: 'path', temp: 'temp', tmp: 'tmp', directory: 'test-data', accessCodeHash: 'synthetic', backendOrigin: 'http://127.0.0.1:4321', backendPort: 4321, backupRoot: 'verification-backup' })
  expect(env.CRM_DATA_PURPOSE).toBe('verification')
  expect(env.CRM_DATA_DIRECTORY).toBe('test-data')
  expect(env.CRM_BACKUP_DIRECTORY).toBe(join('verification-backup', 'primary'))
  expect(env.CRM_BACKUP_STAGING_DIRECTORY).toBe(join('verification-backup', 'staging'))
  expect(env.CRM_BACKUP_RESTORE_DIRECTORY).toBe(join('verification-backup', 'restore'))
  expect(env.CRM_BACKUP_OFFLINE_DIRECTORY).toBe(join('verification-backup', 'offline-not-connected'))
  expect(env).not.toHaveProperty('CRM_OCR_PROVIDER_TOKEN')
})
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
})

it('只转发固定入口和同源写入，保留登录凭据并拒绝伪造代理头', async () => {
  const backend = createServer((req, res) => {
    res.setHeader('set-cookie', 'session=synthetic; HttpOnly; SameSite=Strict')
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie, url: req.url }))
  }).listen(0, '127.0.0.1')
  servers.push(backend)
  await once(backend, 'listening')
  const backendOrigin = `http://127.0.0.1:${(backend.address() as { port: number }).port}`
  const publicOrigin = 'https://192.168.1.20:3443'
  const proxy = createServer(createVerificationProxy({ publicOrigin, backendOrigin })).listen(0, '127.0.0.1')
  servers.push(proxy)
  await once(proxy, 'listening')
  const port = (proxy.address() as { port: number }).port
  const call = (headers: Record<string, string>) => new Promise<{ status: number, body: string, cookie: string[] | undefined }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/commands/customers', method: 'POST', headers }, (res) => {
      let body = ''
      res.on('data', chunk => body += String(chunk))
      res.on('end', () => resolve({ status: res.statusCode!, body, cookie: res.headers['set-cookie'] }))
    })
    req.on('error', reject)
    req.end('{}')
  })
  const good = await call({ host: '192.168.1.20:3443', origin: publicOrigin, cookie: 'session=synthetic' })
  expect(good.status).toBe(200)
  expect(JSON.parse(good.body)).toEqual({ host: new URL(backendOrigin).host, origin: backendOrigin, cookie: 'session=synthetic', url: '/api/commands/customers' })
  expect(good.cookie?.[0]).toContain('; Secure')
  expect((await call({ host: 'evil.example', origin: publicOrigin })).status).toBe(403)
  expect((await call({ host: '192.168.1.20:3443', origin: 'https://evil.example' })).status).toBe(403)
  expect((await call({ 'host': '192.168.1.20:3443', 'origin': publicOrigin, 'x-forwarded-for': '127.0.0.1' })).status).toBe(403)
})
