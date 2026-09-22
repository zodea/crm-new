import process from 'node:process'
import { resolveBusinessSession } from '../../../utils/business-session'
import { coreMigrationTestInstance } from '../../../utils/core-migration-test-instance'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (getHeader(event, 'x-ruihang-test-reset') !== '1')
    throw createError({ statusCode: 403, statusMessage: 'Test reset is forbidden' })
  const session = resolveBusinessSession()
  // 测试专用重置可以销毁合成独立 WBS；正常恢复仍须经过依赖保护。
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
  return { authority: 'local', activeBatchId: null }
})
