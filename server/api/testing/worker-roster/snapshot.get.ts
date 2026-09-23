import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { quantityTestInstance } from '../../../utils/quantity-runtime'
import { workerRosterRuntimeOptions } from '../../../utils/worker-roster-runtime'

/** Test-only transport of the actual named workspace, including private original bytes. */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (getHeader(event, 'x-ruihang-test-reset') !== '1' || !sessionId || !/^worker-roster-[a-f0-9-]{36}$/.test(sessionId)
    || !workerRosterRuntimeOptions.session(sessionId).capabilities.includes('worker:sensitive:read')) {
    throw createError({ statusCode: 403, statusMessage: 'Authorized named test session required' })
  }
  const bytes = await quantityTestInstance.exportSnapshotBytes(sessionId)
  if (!workerRosterRuntimeOptions.session(sessionId).capabilities.includes('worker:sensitive:read'))
    throw createError({ statusCode: 403, statusMessage: 'Private access changed' })
  setHeader(event, 'Cache-Control', 'no-store')
  return { payloadBase64: Buffer.from(bytes).toString('base64'), snapshotSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
})
