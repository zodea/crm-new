import type { CoreMigrationBatchCommandDTO, CoreMigrationBatchDTO } from '../../../../../app/lib/migration/core-contract'
import type { BusinessSession } from '../../../../utils/business-session'
import { resolveBusinessSession } from '../../../../utils/business-session'
import { parseCoreMigrationBatchCommand } from '../../../../utils/core-migration-request'
import { coreMigrationTestInstance } from '../../../../utils/core-migration-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

type BatchOperation = 'import' | 'confirm' | 'rollback'

const RUN: Record<
  BatchOperation,
  (command: CoreMigrationBatchCommandDTO, session: BusinessSession) => Promise<CoreMigrationBatchDTO>
> = {
  import: (command, session) => coreMigrationTestInstance.importBatch(command, session),
  confirm: (command, session) => coreMigrationTestInstance.confirm(command, session),
  rollback: (command, session) => coreMigrationTestInstance.rollback(command, session),
}

function isBatchOperation(value: string): value is BatchOperation {
  return Object.hasOwn(RUN, value)
}

export default defineEventHandler(async (event) => {
  try {
    const operation = getRouterParam(event, 'operation') ?? ''
    if (!isBatchOperation(operation))
      throw createError({ statusCode: 404, statusMessage: 'Core migration operation not found' })
    const command = parseCoreMigrationBatchCommand(
      await readBody(event),
      getRouterParam(event, 'batchId') ?? '',
    )
    return await RUN[operation](command, resolveBusinessSession())
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
