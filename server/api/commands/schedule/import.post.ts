import { scheduleProblem } from '../../../../app/lib/schedule/central-contract'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { scheduleApi } from '../../../utils/schedule-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const api = scheduleApi(event)
    if (body?.action === 'preflight')
      return await api.importPreflight(body)
    if (body?.action === 'adopt')
      return await api.importAdopt(body)
    throw scheduleProblem('validation-failed', 'WBS迁入动作无效')
  }
  catch (cause) { throwProjectReadError(cause) }
})
