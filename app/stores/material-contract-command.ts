import type { MaterialContractFormReadDTO } from '~/lib/material-contract/command-contract'
import { defineStore } from 'pinia'
import { createContractCommandActions } from '~/lib/contract/command-session'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '~/lib/material-contract/command-contract'
import { materialContractProblemFromUnknown } from '~/lib/material-contract/repository'

export class MaterialContractCommandConflictError extends Error {
  constructor(public readonly latest: MaterialContractFormReadDTO) {
    super('材料采购合同已有更新版本，请载入最新版本后继续')
    this.name = 'MaterialContractCommandConflictError'
  }
}

export const useMaterialContractCommandStore = defineStore('material-contract-command', () => createContractCommandActions({
  repository: () => useNuxtApp().$repositories.materialContractCommands,
  capability: MATERIAL_CONTRACT_WRITE_CAPABILITY,
  problemFromUnknown: materialContractProblemFromUnknown,
  conflict: latest => new MaterialContractCommandConflictError(latest),
}))
