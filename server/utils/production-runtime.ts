import type { H3Event } from 'h3'
import { createError } from 'h3'
import { projectProblem } from '../../app/lib/project/repository'
import { MigrationEvidenceProblem } from './migration-snapshot'
import { requireProductionBusinessSession } from './production-auth'
import { getProductionRuntimeConfig } from './production-config'
import { createProductionStorage, ProductionStorageProblem } from './production-storage'

let runtime: { key: string, storage: ReturnType<typeof createProductionStorage> } | null = null
/** Every production domain obtains the same coordinator; no owner opens a second authority. */
export function productionRuntime() {
  const config = getProductionRuntimeConfig()
  if (!config)
    return null
  const key = JSON.stringify([config.directory, config.workspaceId, config.ownerId, config.purpose])
  if (runtime && runtime.key !== key)
    throw createError({ statusCode: 503, data: projectProblem('unavailable', '运行中存储身份配置发生变化，请停止服务后按维护流程重新启动。') })
  if (!runtime)
    runtime = { key, storage: createProductionStorage(config) }
  return runtime
}
export const productionSession = (event: H3Event, options: { touch?: boolean } = {}) => () => requireProductionBusinessSession(event, options)
export function throwProductionStorageError(cause: unknown) {
  if (cause instanceof ProductionStorageProblem)
    throw createError({ statusCode: 503, data: projectProblem('unavailable', cause.message) })
  if (cause instanceof MigrationEvidenceProblem) {
    const code = cause.problem.code
    const statusCode = code === 'forbidden' ? 403 : code === 'unavailable' ? 503 : code === 'not-found' ? 404 : ['stale-source', 'conflict'].includes(code) ? 409 : 422
    throw createError({ statusCode, data: cause.problem })
  }
}
