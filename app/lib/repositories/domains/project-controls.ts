import type { RepositoryFetch } from '../deferred'
import { createBoqBuildingRepository } from '~/lib/boq/central-building-repository'
import { createQuantityRepository } from '~/lib/quantity/central-repository'
import { createTargetCostRepository } from '~/lib/target-cost/central-repository'

export function createProjectControlsRepositories(repositoryFetch: RepositoryFetch) {
  return {
    quantity: createQuantityRepository(repositoryFetch),
    boqBuilding: createBoqBuildingRepository(repositoryFetch),
    targetCosts: createTargetCostRepository(repositoryFetch),
  }
}
