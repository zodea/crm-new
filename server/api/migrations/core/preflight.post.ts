import { resolveBusinessSession } from '../../../utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../../utils/core-migration-request'
import { coreMigrationTestInstance } from '../../../utils/core-migration-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await coreMigrationTestInstance.preflight(
      parseCoreMigrationSourceCommand(await readBody(event)),
      resolveBusinessSession(),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
