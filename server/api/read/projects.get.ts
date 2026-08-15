import { throwProjectReadError } from '../../utils/project-read-error'
import { projectReadTestInstance } from '../../utils/project-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    return await projectReadTestInstance.list(
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
