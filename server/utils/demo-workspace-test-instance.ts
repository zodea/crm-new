import { resolveBusinessSession } from './business-session'

export type DemoWorkspaceTestScenario = 'allowed' | 'forbidden'

export function createDemoWorkspaceTestInstance() {
  const scenarios = new Map<string, DemoWorkspaceTestScenario>()
  const workerPrivateReaders = new Set<string>()
  const supplierPrivateReaders = new Set<string>()
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function capabilities(sessionId?: string | null): readonly string[] {
    const sessionCapabilities = [...resolveBusinessSession().capabilities, ...(sessionId && workerPrivateReaders.has(sessionId) ? ['worker:sensitive:read'] : []), ...(sessionId && supplierPrivateReaders.has(sessionId) ? ['supplier:sensitive:read'] : [])]
    return scenarios.get(keyFor(sessionId)) === 'forbidden'
      ? sessionCapabilities.filter(capability => capability !== 'demo:read')
      : sessionCapabilities
  }

  return {
    setSupplierPrivateRead(sessionId: string, allowed: boolean) {
      if (allowed)
        supplierPrivateReaders.add(sessionId)
      else
        supplierPrivateReaders.delete(sessionId)
    },
    setWorkerPrivateRead(sessionId: string, allowed: boolean) {
      if (allowed)
        workerPrivateReaders.add(sessionId)
      else
        workerPrivateReaders.delete(sessionId)
    },
    reset(next: DemoWorkspaceTestScenario, sessionId?: string | null) {
      const key = keyFor(sessionId)
      if (next === 'allowed')
        scenarios.delete(key)
      else
        scenarios.set(key, next)
    },
    capabilities,
    workspace(sessionId?: string | null) {
      return { allowed: capabilities(sessionId).includes('demo:read') }
    },
  }
}

export const demoWorkspaceTestInstance = createDemoWorkspaceTestInstance()
