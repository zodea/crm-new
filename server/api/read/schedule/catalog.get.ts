import { scheduleProblem } from '../../../../app/lib/schedule/central-contract'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { scheduleApi } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (!['real', 'demo'].includes(String(query.origin)))
      throw scheduleProblem('invalid-query', '请明确排程来源')
    return await scheduleApi(event).catalog(query.origin as 'real' | 'demo', query.includeDemo === 'true')
  }
  catch (cause) { throwProjectReadError(cause) }
})
