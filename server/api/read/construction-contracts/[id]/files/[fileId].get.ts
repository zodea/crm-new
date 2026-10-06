import { createError, defineEventHandler, getHeader, getQuery, getRouterParam, setHeader } from 'h3'
import { resolveBusinessSession } from '../../../../../utils/business-session'
import { constructionContractCommandTestInstance } from '../../../../../utils/construction-contract-command-test-instance'
import { getProductionRuntimeConfig } from '../../../../../utils/production-config'
import { throwProjectReadError } from '../../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    if (getProductionRuntimeConfig())
      throw createError({ statusCode: 503, statusMessage: '施工合同原件正式持久化接管尚未完成' })
    if (getQuery(event).origin !== 'real')
      throw createError({ statusCode: 403, statusMessage: '须明确正式来源才能读取施工合同原件' })
    const result = constructionContractCommandTestInstance.readFileContent(
      getRouterParam(event, 'id') ?? '',
      getRouterParam(event, 'fileId') ?? '',
      resolveBusinessSession(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
    setHeader(event, 'Cache-Control', 'private, no-store')
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    return result
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
