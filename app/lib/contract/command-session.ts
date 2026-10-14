import type { CommandResolution, RecoveryStorage } from '../forms/command-recovery'
import type { ContractFormAttachment, ContractFormAttachmentChanges, F2SaveAction, ProjectContractFormDraft } from './forms'
import { createFormCommandActions } from '../forms/command-session'

interface CommandContext { workspaceId: string, actorId: string, capabilities: readonly string[] }
interface FormRead { draft: ProjectContractFormDraft & { id: string }, attachments: ContractFormAttachment[], version: string, updatedAt: string }
interface CommandResult { id: string, commandId: string, version: string, updatedAt: string, attachmentIds: string[] }

export function createContractCommandActions<C extends CommandContext, Capability extends string, Extra extends object = object, Read extends FormRead = FormRead>(options: {
  repository: () => {
    context: () => Promise<C>
    loadForm: (id: string) => Promise<Read>
    execute: (request: Extra & { id?: string, baseVersion: string | null, action: F2SaveAction, draft: ProjectContractFormDraft, attachments: ContractFormAttachmentChanges, workspaceId: string, actorId: string, requiredCapability: Capability, commandId: string }) => Promise<CommandResult>
    resolve: (commandId: string) => Promise<CommandResolution<CommandResult>>
  }
  capability: Capability
  problemFromUnknown: (cause: unknown) => Error & { problem: { code: string } }
  conflict: (latest: Read) => Error
  recoveryStorage?: () => RecoveryStorage
}) {
  return createFormCommandActions<C, Capability, ProjectContractFormDraft, F2SaveAction, ContractFormAttachmentChanges, Read, Extra>(options)
}
