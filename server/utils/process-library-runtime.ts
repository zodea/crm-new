import type { DataOriginDTO } from '../../app/types/read-model'
import { processLibraryProblem } from '../../app/lib/schedule/process-library-contract'
import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { createProcessLibraryService } from './process-library-service'

export const processLibraryService = createProcessLibraryService()

export function processLibrarySession(sessionId?: string | null) {
  return { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }
}

export function processLibraryOrigin(query: Record<string, unknown>): DataOriginDTO {
  if (Object.keys(query).some(key => !['origin', 'includeDemo'].includes(key))
    || (query.origin !== 'real' && query.origin !== 'demo')
    || ![undefined, true, false, 'true', 'false'].includes(query.includeDemo as never)) {
    throw processLibraryProblem('invalid-query', '工序库读取参数需要明确来源')
  }
  if (query.origin === 'demo' && query.includeDemo !== true && query.includeDemo !== 'true')
    throw processLibraryProblem('forbidden', '请先明确开启演示数据')
  return query.origin
}
