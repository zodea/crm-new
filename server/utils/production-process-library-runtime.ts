import { createProductionProcessLibraryService } from './production-process-library-service'
import { productionRuntime } from './production-runtime'

let service: ReturnType<typeof createProductionProcessLibraryService> | null = null
export function productionProcessLibraries() {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  service ??= createProductionProcessLibraryService(runtime.storage)
  return service
}
