import { auxiliaryContractInstance, auxiliaryContractSession } from '../../../utils/auxiliary-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return auxiliaryContractInstance(key).context(auxiliaryContractSession(key))
  }
  catch (cause) { throwProjectReadError(cause) }
})
