import process from 'node:process'
import { resolveBusinessSession } from '../../../utils/business-session'
import { prepareCoreMigrationCommandSources } from '../../../utils/core-migration-preparation'
import { coreMigrationTestInstance } from '../../../utils/core-migration-test-instance'
import { crewWorkerCommandTestInstance } from '../../../utils/crew-worker-command-test-instance'
import { projectCommandTestInstance } from '../../../utils/project-command-test-instance'
import { quantityTestInstance } from '../../../utils/quantity-runtime'

/** Copy an already confirmed public migration into an isolated browser-test session. */
export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  if (getHeader(event, 'x-ruihang-test-reset') !== '1' || !sessionId || sessionId === 'default')
    throw createError({ statusCode: 403, statusMessage: 'Named test session required' })
  const snapshot = coreMigrationTestInstance.snapshot(resolveBusinessSession())
  if (snapshot.authority !== 'central')
    throw createError({ statusCode: 409, statusMessage: 'Confirmed migration required' })
  const prepared = await prepareCoreMigrationCommandSources(snapshot, [
    { prepareMigrationSnapshot: value => projectCommandTestInstance.prepareMigrationSnapshot(value, sessionId) },
    { prepareMigrationSnapshot: value => crewWorkerCommandTestInstance.prepareMigrationSnapshot(value, sessionId) },
  ], [{ prepareMigrationSnapshot: value => quantityTestInstance.prepareMigrationSnapshot(value, sessionId) }])
  try {
    prepared.commit()
  }
  catch (cause) {
    await prepared.abort()
    throw cause
  }
  return { prepared: true }
})
