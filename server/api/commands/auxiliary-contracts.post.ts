import { auxiliaryContractInstance, auxiliaryContractSession } from '../../utils/auxiliary-contract-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return await auxiliaryContractInstance(key).execute(await readBody(event), auxiliaryContractSession(key))
  }
  catch (cause) { throwProjectReadError(cause) }
})
