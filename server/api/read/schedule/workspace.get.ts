import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseScheduleRead } from '../../../utils/schedule-request'
import { scheduleApi } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    return await scheduleApi(event).read(parseScheduleRead(query), typeof query.contractId === 'string' ? query.contractId : '')
  }
  catch (cause) { throwProjectReadError(cause) }
})
