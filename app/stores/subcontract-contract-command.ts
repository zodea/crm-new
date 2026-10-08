import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { SubcontractContractCommandContextDTO, SubcontractContractFormReadDTO } from '~/lib/subcontract-contract/command-contract'
import { defineStore } from 'pinia'
import { createContractCommandActions } from '~/lib/contract/command-session'
import { SUBCONTRACT_CONTRACT_WRITE_CAPABILITY } from '~/lib/subcontract-contract/command-contract'
import { subcontractContractUnavailable } from '~/lib/subcontract-contract/repository'

export class SubcontractContractCommandConflictError extends Error {
  constructor(public readonly latest: SubcontractContractFormReadDTO) {
    super('分包合同已有更新版本，请载入最新版本后继续')
    this.name = 'SubcontractContractCommandConflictError'
  }
}

export const useSubcontractContractCommandStore = defineStore('subcontract-contract-command', () => createContractCommandActions<SubcontractContractCommandContextDTO, typeof SUBCONTRACT_CONTRACT_WRITE_CAPABILITY, { constructionMain?: ConstructionMainSelection }, SubcontractContractFormReadDTO>({
  repository: () => useNuxtApp().$repositories.subcontractContractCommands,
  capability: SUBCONTRACT_CONTRACT_WRITE_CAPABILITY,
  problemFromUnknown: subcontractContractUnavailable,
  conflict: latest => new SubcontractContractCommandConflictError(latest),
}))
