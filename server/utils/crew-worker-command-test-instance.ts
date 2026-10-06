import type { CrewWorkerCommandOptions } from './crew-worker-command-service'
import { createCrewWorkerCommandService } from './crew-worker-command-service'
import { projectCommandTestInstance } from './project-command-test-instance'

/** Development adapter supplies its explicit project source; the domain service owns no database. */
export function createCrewWorkerCommandTestInstance(options: CrewWorkerCommandOptions = {}) {
  return createCrewWorkerCommandService({ ...options, projectIds: options.projectIds ?? (sessionId => projectCommandTestInstance.rows(sessionId).filter(row => row.dataOrigin === 'real').map(row => row.id)) })
}

export const crewWorkerCommandTestInstance = createCrewWorkerCommandTestInstance()
