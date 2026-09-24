import { throwProjectReadError } from '../../../utils/project-read-error'
import { subcontractContractReadTestInstance } from '../../../utils/subcontract-contract-read-test-instance'

export default defineEventHandler((event) => {
  try {
    return subcontractContractReadTestInstance.detail(getRouterParam(event, 'id') ?? '', getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
