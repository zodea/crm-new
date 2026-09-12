import { throwProjectReadError } from '../../utils/project-read-error'
import { parseScheduleCommand } from '../../utils/schedule-request'
import { scheduleService } from '../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await scheduleService.execute(parseScheduleCommand(await readBody(event)), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
