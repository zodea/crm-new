import { materialContractReadTestInstance } from '../../utils/material-contract-read-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return materialContractReadTestInstance.list(
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
