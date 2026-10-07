import { scheduleProblem } from '../../../../app/lib/schedule/central-contract'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { scheduleApi } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (Object.keys(query).join(',') !== 'projectId' || typeof query.projectId !== 'string' || !query.projectId.trim())
      throw scheduleProblem('invalid-query', 'WBS原件须有唯一明确项目身份')
    const read = await scheduleApi(event).files(query.projectId)
    return { files: read.files }
  }
  catch (cause) { throwProjectReadError(cause) }
})
