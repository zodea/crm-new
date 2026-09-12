import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

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
  return {
    captured,
    failOnce: () => { failNext = true },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}
