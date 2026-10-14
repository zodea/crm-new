import type { AuxiliaryContractDraft, AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'
import type { AuxiliaryContractContext, AuxiliaryContractFormRead, AuxiliaryContractResult } from '~/lib/auxiliary-contract/repository'
import type { ConstructionMainSelection } from '~/lib/construction-scope/contract'
import type { ContractFormAttachmentChanges, F2SaveAction } from '~/lib/contract/forms'
import type { CommandRecoveryDescriptor, CommandResolution } from '~/lib/forms/command-recovery'
import { defineStore } from 'pinia'
import { auxiliaryProblem } from '~/lib/auxiliary-contract/contract'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { createFormCommandActions } from '~/lib/forms/command-session'

export function createAuxiliaryContractCommandActions(kind: AuxiliaryContractKind, repository: () => ReturnType<typeof import('~/lib/auxiliary-contract/repository').createAuxiliaryContractRepository>, storage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const recovery = createCommandRecoveryStorage(storage)
  const scopes = new Map<string, CommandRecoveryDescriptor>()
  return createFormCommandActions<AuxiliaryContractContext, 'auxiliary-contract:write', AuxiliaryContractDraft, F2SaveAction, ContractFormAttachmentChanges, AuxiliaryContractFormRead, { constructionMain?: ConstructionMainSelection }>({
    repository: () => ({
      context: repository().context,
      loadForm: id => repository().loadForm(id, kind),
      execute: repository().execute,
      resolve: async (commandId): Promise<CommandResolution<AuxiliaryContractResult>> => {
        const descriptor = scopes.get(commandId)
        if (!descriptor)
          throw auxiliaryProblem('unavailable', '辅助合同缺原提交范围，请保留编号并恢复原页面')
        const resolution = await repository().resolve({ commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, action: 'save', scopeId: descriptor.targetId ?? `new-${kind}` })
        if (resolution.outcome === 'not-applied')
          return resolution
        if (!('id' in resolution.result))
          throw auxiliaryProblem('unavailable', '辅助合同原号回执不是该合同保存结果')
        return { outcome: 'applied', result: resolution.result }
      },
    }),
    capability: 'auxiliary-contract:write',
    problemFromUnknown: auxiliaryProblemFromUnknown,
    conflict: () => auxiliaryProblem('conflict', '辅助合同已有更新，请明确载入最新版后继续'),
    recoveryAdapter: {
      key: scope => commandRecoveryKey({ ...scope, ...(scope.targetId === null ? { scopeId: kind } : {}) }),
      read: (key, scope) => {
        const descriptor = recovery.read(key)
        if (descriptor) {
          if (descriptor.family !== 'auxiliary-contract' || descriptor.targetId !== scope.targetId || descriptor.workspaceId !== scope.workspaceId || descriptor.actorId !== scope.actorId || descriptor.scopeId !== kind)
            throw auxiliaryProblem('unavailable', '辅助合同原号范围与当前类型或可信身份不同')
          scopes.set(descriptor.commandId, descriptor)
        }
        return descriptor
      },
      remember: (key, descriptor) => {
        const saved = { ...descriptor, scopeId: kind }
        recovery.remember(key, saved)
        scopes.set(saved.commandId, saved)
      },
      verify: recovery.verify,
      clear: recovery.clear,
    },
  })
}

export const useAuxiliaryContractCommandStore = defineStore('auxiliary-contract-command', () => {
  const actions = {
    other_expense: createAuxiliaryContractCommandActions('other_expense', () => useNuxtApp().$repositories.auxiliaryContracts),
    company_expense: createAuxiliaryContractCommandActions('company_expense', () => useNuxtApp().$repositories.auxiliaryContracts),
  }
  return { forKind: (kind: AuxiliaryContractKind) => actions[kind] }
})
