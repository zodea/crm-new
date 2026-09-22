import type { WorkerRosterCommand } from '../../../app/lib/worker-roster/contract'
import { rosterProblem } from '../../../app/lib/worker-roster/contract'
import { rosterObject } from '../../../app/lib/worker-roster/validation'
import { throwProjectReadError } from '../../utils/project-read-error'
import { workerRosterService } from '../../utils/worker-roster-runtime'

export default defineEventHandler(async (event) => {
  try {
    const body: unknown = await readBody(event)
    if (!rosterObject(body) || Object.keys(body).some(key => !['commandId', 'action'].includes(key)))
      return rosterProblem('invalid-query', '待核对提交无效')
    return await workerRosterService.resolve(String(body.commandId ?? ''), body.action as WorkerRosterCommand['action'], getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
