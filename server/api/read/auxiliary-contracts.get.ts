import { auxiliaryContractInstance, auxiliaryContractSession } from '../../utils/auxiliary-contract-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler((event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return auxiliaryContractInstance(key).list(getQuery(event), auxiliaryContractSession(key))
  }
  catch (cause) { throwProjectReadError(cause) }
})
