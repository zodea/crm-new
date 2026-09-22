import process from 'node:process'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (getHeader(event, 'x-ruihang-test-reset') !== '1' || !sessionId || sessionId === 'default')
    throw createError({ statusCode: 403, statusMessage: 'Named test session required' })
  const body = await readBody<{ allowed?: boolean }>(event)
  if (typeof body?.allowed !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: 'Explicit access state required' })
  demoWorkspaceTestInstance.setWorkerPrivateRead(sessionId, body.allowed)
  return { allowed: body.allowed }
})
