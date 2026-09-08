import { otherSettlementInstance, otherSettlementSession } from '../../utils/other-settlement-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    return await otherSettlementInstance(key).execute(await readBody(event), otherSettlementSession(key))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
