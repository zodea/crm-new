import { throwProjectReadError } from '../../utils/project-read-error'
import { parseScheduleCommand } from '../../utils/schedule-request'
import { scheduleApi } from '../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await scheduleApi(event).execute(parseScheduleCommand(await readBody(event)))
  }
  catch (cause) { throwProjectReadError(cause) }
})
