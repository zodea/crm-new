import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createPortProbe } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { expect } from '@playwright/test'

/** 仅监听回环且只接受约定合成原件，不接触真实 OCR 服务或真实凭证。 */
export async function startSyntheticCredentialOcr(pdf: Buffer, port = 3188) {
  let failNext = false
  let jobs = 0
  const captured: Array<{ fileName: string, options: unknown, bytes: Buffer }> = []
  const markdown = '营业执照\n公司名称：OCR 合成识别有限公司\n统一社会信用代码：913100001234567890\n纳税人识别号：913100009876543210\n法定代表人：合成人员\n有效期至：2029-12-31'
  const server = createServer(async (request, response) => {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    try {
      if (request.method === 'POST' && request.url === '/api/v2/ocr/jobs') {
        if (request.headers.authorization !== 'Bearer synthetic-credential-447')
          return json(403, { code: 1, message: '仅允许合成测试身份' })
        const chunks: Buffer[] = []
        for await (const chunk of request)
          chunks.push(Buffer.from(chunk))
        const multipart = await new Request(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': request.headers['content-type'] || '' }, body: Buffer.concat(chunks) }).formData()
        const file = multipart.get('file') as File
        const bytes = Buffer.from(await file.arrayBuffer())
        if (!bytes.equals(pdf))
          return json(400, { code: 1, message: '拒绝非约定合成原件' })
        captured.push({ fileName: file.name, options: JSON.parse(String(multipart.get('optionalPayload'))), bytes })
        if (failNext) {
          failNext = false
          return json(400, { code: 1, message: '合成识别服务故障，请重试' })
        }
        return json(200, { code: 0, data: { jobId: `synthetic-${++jobs}` } })
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/v2/ocr/jobs/'))
        return json(200, { code: 0, data: { state: 'done', resultUrl: { jsonUrl: `http://127.0.0.1:${port}/synthetic-result.jsonl` } } })
      if (request.url === '/synthetic-result.jsonl')
        return json(200, { result: { dataInfo: { synthetic: true }, layoutParsingResults: [{ markdown: { text: markdown, images: {} }, prunedResult: {} }] } })
      json(404, { code: 1, message: '不存在的合成服务路径' })
    }
    catch { json(500, { code: 1, message: '合成测试服务处理失败' }) }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  port = (server.address() as { port: number }).port
  return {
    origin: `http://127.0.0.1:${port}`,
    captured,
    failOnce: () => { failNext = true },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}

/** 专属 Nuxt 测试实例持有合成 OCR 配置和构建目录，不继承日常服务的 OCR 身份。 */
export async function startSyntheticCredentialApplication(pdf: Buffer, outputDirectory: string) {
  const synthetic = await startSyntheticCredentialOcr(pdf, 0)
  const directory = resolve(outputDirectory)
  await mkdir(directory, { recursive: true })
  const probe = createPortProbe().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  // Windows 生成的类型相对路径须与项目同盘；独立目录同时避开主服务的 .nuxt。
  const buildDir = resolve('.codex-tmp', 'credential-ocr', randomUUID(), 'build')
  await writeFile(resolve(directory, 'nuxt.config.ts'), `export default { buildDir: ${JSON.stringify(buildDir)}, devtools: { enabled: false } }`, 'utf8')
  const child = spawn(process.execPath, [resolve('node_modules/nuxt/bin/nuxt.mjs'), 'dev', '--host', '127.0.0.1', '--port', String(port), '--no-fork', '--extends', directory, '--dotenv', resolve(directory, 'synthetic-only.env')], {
    cwd: resolve('.'),
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', CRM_RUN_MODE: 'development', NUXT_DEVTOOLS: 'false', NUXT_IGNORE_LOCK: '1', NUXT_PADDLE_OCR_BASE_URL: synthetic.origin, NUXT_PADDLE_OCR_ACCESS_TOKEN: 'synthetic-credential-447' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  const captureOutput = (data: unknown) => {
    logs = `${logs}${String(data)}`.slice(-12_000)
  }
  child.stdout!.on('data', captureOutput)
  child.stderr!.on('data', captureOutput)
  let closed = false
  const close = async () => {
    if (closed)
      return
    closed = true
    try {
      if (child.exitCode === null) {
        const exited = once(child, 'exit')
        if (process.platform === 'win32' && child.pid)
          await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
        else
          child.kill()
        await exited
      }
    }
    finally {
      await synthetic.close()
      await writeFile(resolve(directory, 'application.log'), logs, 'utf8')
    }
  }
  try {
    await expect.poll(async () => {
      if (child.exitCode !== null)
        throw new Error(`合成 OCR 应用启动失败：${logs}`)
      try {
        const response = await fetch(`${origin}/api/ocr/status`, { signal: AbortSignal.timeout(5_000) })
        return response.ok && (await response.json()).configured === true
      }
      catch { return false }
    }, { timeout: 150_000 }).toBe(true)
    return { ...synthetic, origin, close }
  }
  catch (cause) {
    await close()
    throw cause
  }
}
