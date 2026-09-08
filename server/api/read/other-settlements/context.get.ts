import { otherSettlementInstance, otherSettlementSession } from '../../../utils/other-settlement-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return otherSettlementInstance(key).context(otherSettlementSession(key))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
