import { throwProjectReadError } from '../../utils/project-read-error'
import { workerRosterService } from '../../utils/worker-roster-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await workerRosterService.execute(await readBody(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) { throwProjectReadError(cause) }
})
