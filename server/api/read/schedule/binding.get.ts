import { scheduleProblem } from '../../../../app/lib/schedule/central-contract'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseScheduleRead } from '../../../utils/schedule-request'
import { scheduleApi } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (Object.keys(query).some(key => !['projectId', 'origin', 'includeDemo', 'today', 'groupId', 'contractId'].includes(key))
      || typeof query.groupId !== 'string' || !query.groupId.trim()
      || (query.contractId !== undefined && typeof query.contractId !== 'string')) {
      throw scheduleProblem('invalid-query', '绑定预览的分组或施工合同身份无效')
    }
    return await scheduleApi(event).binding(parseScheduleRead(query), query.groupId, query.contractId as string | undefined)
  }
  catch (cause) { throwProjectReadError(cause) }
})
