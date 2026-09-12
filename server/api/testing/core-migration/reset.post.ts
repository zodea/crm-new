import process from 'node:process'
import { resolveBusinessSession } from '../../../utils/business-session'
import { coreMigrationTestInstance } from '../../../utils/core-migration-test-instance'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const session = resolveBusinessSession()
  await coreMigrationTestInstance.reset(session.workspaceId)
  return { authority: 'local', activeBatchId: null }
})
