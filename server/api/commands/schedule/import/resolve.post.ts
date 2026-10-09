import { throwProjectReadError } from '../../../../utils/project-read-error'
import { scheduleApi } from '../../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await scheduleApi(event).importResolve(await readBody(event))
  }
  catch (cause) { throwProjectReadError(cause) }
})
