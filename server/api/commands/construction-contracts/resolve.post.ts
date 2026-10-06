import { defineEventHandler, getHeader, readBody } from 'h3'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { constructionContractCommandTestInstance } from '../../../utils/construction-contract-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const commandId = parseResolveCommandBody(await readBody(event))
    return constructionContractCommandTestInstance.resolve(commandId, resolveBusinessSession(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
