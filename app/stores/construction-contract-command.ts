import type { ConstructionContractFormReadDTO } from '~/lib/construction-contract/command-contract'
import { defineStore } from 'pinia'
import { CONSTRUCTION_CONTRACT_WRITE_CAPABILITY } from '~/lib/construction-contract/command-contract'
import { constructionContractProblemFromUnknown } from '~/lib/construction-contract/repository'
import { createContractCommandActions } from '~/lib/contract/command-session'

export class ConstructionContractCommandConflictError extends Error {
  constructor(public readonly latest: ConstructionContractFormReadDTO) {
    super('施工合同已有更新版本，请载入最新版本后继续')
    this.name = 'ConstructionContractCommandConflictError'
  }
}

export const useConstructionContractCommandStore = defineStore('construction-contract-command', () => createContractCommandActions({
  repository: () => useNuxtApp().$repositories.constructionContractCommands,
  capability: CONSTRUCTION_CONTRACT_WRITE_CAPABILITY,
  problemFromUnknown: constructionContractProblemFromUnknown,
  conflict: latest => new ConstructionContractCommandConflictError(latest),
}))
