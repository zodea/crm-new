import { createServer } from 'node:http'
import process from 'node:process'
import { createApp, createError, createRouter, defineEventHandler, getHeader, getQuery, getRouterParam, readBody, toNodeListener } from 'h3'
import middleware from '../../server/middleware/production-access'

async function start() {
  Object.assign(globalThis, { createError, defineEventHandler, getHeader, getQuery, getRouterParam, readBody })
  const app = createApp({ debug: false }).use(middleware)
  const router = createRouter()
  router.post('/api/auth/login', (await import('../../server/api/auth/login.post')).default)
  router.post('/api/auth/logout', (await import('../../server/api/auth/logout.post')).default)
  router.get('/api/auth/status', (await import('../../server/api/auth/status.get')).default)
  router.get('/api/read/business-session', (await import('../../server/api/read/business-session.get')).default)
  router.get('/api/production/status', (await import('../../server/api/production/status.get')).default)
  router.get('/api/read/process-libraries', (await import('../../server/api/read/process-libraries.get')).default)
  router.get('/api/read/process-libraries/:id', (await import('../../server/api/read/process-libraries/[id].get')).default)
  router.post('/api/commands/process-libraries', (await import('../../server/api/commands/process-libraries.post')).default)
  app.use(router)
  createServer(toNodeListener(app)).listen(Number(process.env.NITRO_PORT), '127.0.0.1')
}
void start().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
