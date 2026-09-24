import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseScheduleRead } from '../../../utils/schedule-request'
import { scheduleService } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    return await scheduleService.read(parseScheduleRead(query), typeof query.contractId === 'string' ? query.contractId : '', getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
