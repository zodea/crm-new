import { otherSettlementInstance, otherSettlementSession } from '../../../../utils/other-settlement-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return otherSettlementInstance(key).source(getRouterParam(event, 'id')!, String(getQuery(event).factId ?? ''), otherSettlementSession(key))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
