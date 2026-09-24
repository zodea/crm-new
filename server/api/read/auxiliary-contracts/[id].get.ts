import { auxiliaryContractInstance, auxiliaryContractSession } from '../../../utils/auxiliary-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return auxiliaryContractInstance(key).detail(getRouterParam(event, 'id')!, getQuery(event), auxiliaryContractSession(key))
  }
  catch (cause) { throwProjectReadError(cause) }
})
