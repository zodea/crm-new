import { resolveBusinessSession } from '../../../utils/business-session'
import { coreMigrationTestInstance } from '../../../utils/core-migration-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(() => {
  try {
    return coreMigrationTestInstance.snapshot(resolveBusinessSession())
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
