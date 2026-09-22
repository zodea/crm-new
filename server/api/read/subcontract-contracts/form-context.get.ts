import { resolveBusinessSession } from '../../../utils/business-session'
import { subcontractContractCommandTestInstance } from '../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler((event) => {
  const session = resolveBusinessSession()
  return subcontractContractCommandTestInstance.context(session, getHeader(event, 'x-ruihang-test-session'))
})
