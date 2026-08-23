import { crewWorkerReadTestInstance } from '../../utils/crew-worker-read-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await crewWorkerReadTestInstance.listCrews(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
