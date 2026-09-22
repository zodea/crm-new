import type { QuantityReadQuery } from './central-contract'
import type { QuantityStageAction, QuantityStageWorkspace } from './central-stages'
import type { QuantityWorkspaceDependencies } from './workspace-state'
import { createQuantityWorkspaceState } from './workspace-state'

export function createQuantityStageState(dependencies: QuantityWorkspaceDependencies<QuantityStageWorkspace, QuantityReadQuery, QuantityStageAction>) {
  return createQuantityWorkspaceState(dependencies)
}
