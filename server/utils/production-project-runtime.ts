import { createError } from 'h3'
import { projectProblem } from '../../app/lib/project/repository'
import { createProductionProjectService } from './production-project-service'
import { productionRuntime } from './production-runtime'

let domain: { key: string, projects: ReturnType<typeof createProductionProjectService> } | null = null
export function productionProjectRuntime() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  if (!domain)
    domain = { key: runtime.key, projects: createProductionProjectService(runtime.storage) }
  return { ...runtime, projects: domain.projects }
}
export function requireProductionProjects() {
  const runtime = productionProjectRuntime()
  if (!runtime)
    throw createError({ statusCode: 503, data: projectProblem('unavailable', '项目正式保存尚未启用。') })
  return runtime.projects
}
