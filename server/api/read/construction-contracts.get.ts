import { constructionContractReadTestInstance } from '../../utils/construction-contract-read-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return constructionContractReadTestInstance.list(
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
