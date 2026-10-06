import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { resolveBusinessSession } from '../../../../../utils/business-session'
import { getProductionRuntimeConfig } from '../../../../../utils/production-config'
import { throwProjectReadError } from '../../../../../utils/project-read-error'
import { subcontractContractCommandTestInstance } from '../../../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler((event) => {
  try {
    if (getProductionRuntimeConfig())
      throw createError({ statusCode: 503, statusMessage: '分包合同原件正式持久化接管尚未完成' })
    if (getQuery(event).origin !== 'real')
      throw createError({ statusCode: 403, statusMessage: '须明确正式来源才能读取分包合同原件' })
    const result = subcontractContractCommandTestInstance.readFileContent(
      getRouterParam(event, 'id') ?? '',
      getRouterParam(event, 'fileId') ?? '',
      resolveBusinessSession(event),
    )
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return result
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
