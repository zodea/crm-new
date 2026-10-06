import { defineEventHandler, readBody } from 'h3'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { coreMigrationTestInstance } from '../../../utils/core-migration-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await coreMigrationTestInstance.resolve(parseResolveCommandBody(await readBody(event)), resolveBusinessSession())
  }
  catch (cause) { throwProjectReadError(cause) }
})
