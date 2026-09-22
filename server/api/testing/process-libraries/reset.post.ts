import process from 'node:process'
import { createError, defineEventHandler, getHeader } from 'h3'
import { processLibraryService, processLibrarySession } from '../../../utils/process-library-runtime'

export default defineEventHandler((event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (getHeader(event, 'x-ruihang-test-reset') !== '1' || !sessionId)
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  processLibraryService.resetTestSession(processLibrarySession(sessionId), sessionId)
  return { ok: true }
})
