import { once } from 'node:events'
import { createServer } from 'node:http'
import process from 'node:process'
import { createApp, createError, createRouter, defineEventHandler, getHeader, getQuery, getRouterParam, readBody, toNodeListener } from 'h3'
import middleware from '../../server/middleware/production-access'

async function start() {
  let providerOrigin = ''
  // A local protocol fixture supplies synthetic OCR text; no external service or real credentials.
  const provider = createServer((request, response) => {
    request.resume()
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'POST')
      response.end(JSON.stringify({ code: 0, data: { jobId: 'synthetic-job' } }))
    else if (request.url === '/result')
      response.end(JSON.stringify({ result: { dataInfo: { numPages: 1 }, layoutParsingResults: [{ markdown: { text: '营业执照\n公司名称：识别候选公司\n统一社会信用代码：913100001234567890', images: {} }, prunedResult: {} }] } }))
    else response.end(JSON.stringify({ code: 0, data: { state: 'done', resultUrl: { jsonUrl: `${providerOrigin}/result` } } }))
  }).listen(0, '127.0.0.1')
  await once(provider, 'listening')
  providerOrigin = `http://127.0.0.1:${(provider.address() as { port: number }).port}`
  Object.assign(globalThis, { createError, defineEventHandler, getHeader, getQuery, getRouterParam, readBody, useRuntimeConfig: () => ({ paddleOcrAccessToken: process.env.SUPPLIER_TEST_OCR_FAILURE ? '' : 'synthetic-token', paddleOcrBaseUrl: providerOrigin }) })
  const app = createApp({ debug: false }).use(middleware)
  const router = createRouter()
  router.post('/api/auth/login', (await import('../../server/api/auth/login.post')).default)
  router.post('/api/auth/logout', (await import('../../server/api/auth/logout.post')).default)
  router.get('/api/auth/status', (await import('../../server/api/auth/status.get')).default)
  router.get('/api/read/business-session', (await import('../../server/api/read/business-session.get')).default)
  router.get('/api/read/suppliers', (await import('../../server/api/read/suppliers.get')).default)
  router.get('/api/read/suppliers/:id', (await import('../../server/api/read/suppliers/[id].get')).default)
  router.get('/api/read/suppliers/:id/form', (await import('../../server/api/read/suppliers/[id]/form.get')).default)
  router.get('/api/read/supplier-credentials/:supplierId', (await import('../../server/api/read/supplier-credentials/[supplierId].get')).default)
  router.get('/api/read/supplier-credentials/:supplierId/files/:fileId', (await import('../../server/api/read/supplier-credentials/[supplierId]/files/[fileId].get')).default)
  router.post('/api/commands/suppliers', (await import('../../server/api/commands/suppliers.post')).default)
  router.post('/api/commands/suppliers/import', (await import('../../server/api/commands/suppliers/import.post')).default)
  router.put('/api/commands/suppliers/:id', (await import('../../server/api/commands/suppliers/[id].put')).default)
  router.post('/api/commands/suppliers/:id/taxpayer-verification', (await import('../../server/api/commands/suppliers/[id]/taxpayer-verification.post')).default)
  router.post('/api/commands/supplier-credentials', (await import('../../server/api/commands/supplier-credentials.post')).default)
  router.post('/api/commands/supplier-resolve', (await import('../../server/api/commands/supplier-resolve.post')).default)
  router.get('/api/read/notifications', (await import('../../server/api/read/notifications.get')).default)
  router.post('/api/commands/notifications', (await import('../../server/api/commands/notifications.post')).default)
  // Same startup catch-up used by the Nitro plugin, with the real production owner and storage.
  await (await import('../../server/utils/production-notification-runtime')).productionNotificationRuntime()?.notifications.scheduled()
  app.use(router)
  createServer(toNodeListener(app)).listen(Number(process.env.NITRO_PORT), '127.0.0.1')
}
void start().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
