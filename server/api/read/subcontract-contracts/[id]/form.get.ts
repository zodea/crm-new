import { resolveBusinessSession } from '../../../../utils/business-session'
import { throwProjectReadError } from '../../../../utils/project-read-error'
import { subcontractContractCommandTestInstance } from '../../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler((event) => {
  try {
    return subcontractContractCommandTestInstance.form(getRouterParam(event, 'id') ?? '', resolveBusinessSession())
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
