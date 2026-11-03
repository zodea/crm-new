import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** 局域网验证入口只转发到本机隔离服务，不信任客户端代理头。 */
export function createVerificationProxy({ publicOrigin, backendOrigin }) {
  const external = new URL(publicOrigin)
  const backend = new URL(backendOrigin)
  if (external.protocol !== 'https:' || external.origin !== publicOrigin || backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || backend.origin !== backendOrigin)
    throw new Error('验证入口地址无效')
  return (req, res) => {
    const reject = () => {
      res.writeHead(403, { 'cache-control': 'no-store' })
      res.end('验证入口拒绝请求')
    }
    if (req.headers.host !== external.host || req.headers['sec-fetch-site'] === 'cross-site'
      || Object.keys(req.headers).some(name => name.startsWith('x-forwarded-') || name.startsWith('x-ruihang-test') || name === 'forwarded')
      || !req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')
      || (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== publicOrigin)) {
      return reject()
    }
    const headers = { ...req.headers, host: backend.host }
    if (headers.origin)
      headers.origin = backendOrigin
    const upstream = httpRequest({ hostname: '127.0.0.1', port: backend.port, method: req.method, path: req.url, headers }, (response) => {
      const outgoing = { ...response.headers }
      if (outgoing['set-cookie'])
        outgoing['set-cookie'] = outgoing['set-cookie'].map(cookie => /(?:^|;)\s*secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`)
      res.writeHead(response.statusCode ?? 502, outgoing)
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent)
        res.writeHead(502, { 'cache-control': 'no-store' })
      res.end('本机验证服务不可用')
    })
    req.pipe(upstream)
  }
}

async function main() {
  const { CRM_LAN_TEST_ORIGIN: publicOrigin, CRM_LAN_TEST_CERT: certPath, CRM_LAN_TEST_KEY: keyPath, CRM_DATA_DIRECTORY: directory, CRM_ACCESS_CODE_HASH: accessCodeHash } = process.env
  if (!publicOrigin || !certPath || !keyPath || !directory || !accessCodeHash)
    throw new Error('隔离验证入口配置不完整')
  const external = new URL(publicOrigin)
  const octets = external.hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    || !(octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))) {
    throw new Error('验证入口只允许指定私有 IPv4 地址')
  }
  const probe = createNetServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const backendPort = probe.address().port
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  const backendOrigin = `http://127.0.0.1:${backendPort}`
  const backend = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: 'ignore',
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_PURPOSE: 'verification', CRM_WORKSPACE_ID: 'lan-verification', CRM_OWNER_ID: 'lan-owner', CRM_DATA_DIRECTORY: directory, CRM_PUBLIC_ORIGIN: backendOrigin, CRM_ACCESS_CODE_HASH: accessCodeHash, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(backendPort), PORT: String(backendPort) },
  })
  const stop = () => {
    backend.kill()
  }
  process.on('exit', stop)
  process.on('SIGINT', () => {
    stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    stop()
    process.exit(0)
  })
  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (backend.exitCode !== null)
        throw new Error('本机隔离验证服务无法启动')
      try {
        const status = await fetch(`${backendOrigin}/api/auth/status`).then(response => response.json())
        if (status.mode === 'production' && status.purpose === 'verification') {
          ready = true
          break
        }
      }
      catch {}
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    if (!ready)
      throw new Error('本机隔离验证服务未就绪')
    const server = createHttpsServer({ cert: await readFile(certPath), key: await readFile(keyPath) }, createVerificationProxy({ publicOrigin, backendOrigin }))
    server.on('upgrade', (_request, socket) => socket.destroy())
    server.listen(Number(external.port || 443), external.hostname)
    backend.on('exit', () => server.close())
  }
  catch (error) {
    stop()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => { process.exitCode = 1 })
