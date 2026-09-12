import { scheduleProblem } from '../../../../app/lib/schedule/central-contract'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseScheduleRead } from '../../../utils/schedule-request'
import { scheduleService } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const ids = typeof query.buildingIds === 'string' ? [query.buildingIds] : query.buildingIds ?? []
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()))
      throw scheduleProblem('invalid-query', '楼栋范围无效')
    return await scheduleService.scope(parseScheduleRead(query), ids as string[], getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
