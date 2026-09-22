import { resolveBusinessSession } from './business-session'
import { demoWorkspaceTestInstance } from './demo-workspace-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'
import { supplierCredentialDemoScope } from './supplier-credential-demo'
import { createSupplierCredentialService } from './supplier-credential-service'

export const supplierCredentialService = createSupplierCredentialService({ read: supplierCommandTestInstance.readCredentialScope, transact: supplierCommandTestInstance.transactCredentialScope, demoRead: supplierCredentialDemoScope })
export function supplierCredentialSession(sessionId?: string | null) {
  return { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }
}
