import type { ContractFormAttachment, ContractFormAttachmentChanges, F2SaveAction, ProjectContractFormDraft } from './forms'
import { readonly, shallowRef } from 'vue'

interface CommandContext { workspaceId: string, actorId: string }
interface FormRead { draft: ProjectContractFormDraft & { id: string }, attachments: ContractFormAttachment[], version: string, updatedAt: string }
interface CommandResult { id: string, commandId: string, version: string, updatedAt: string, attachmentIds: string[] }
interface CommandContent { id?: string, baseVersion: string | null, action: F2SaveAction, draft: ProjectContractFormDraft, attachments: ContractFormAttachmentChanges }

interface FormSession<C> {
  targetId: string | null
  baseVersion: string | null
  context: C | null
  generation: number
  pending: { id: string, fingerprint: string } | null
}

/** 表单持有会话，Pinia action 执行写入；store 不积累已关闭表单的缓存。 */
export function createContractCommandActions<C extends CommandContext, Capability extends string>(options: {
  repository: () => {
    context: () => Promise<C>
    loadForm: (id: string) => Promise<FormRead>
    execute: (request: CommandContent & CommandContext & { requiredCapability: Capability, commandId: string }) => Promise<CommandResult>
  }
  capability: Capability
  problemFromUnknown: (cause: unknown) => Error & { problem: { code: string } }
  conflict: (latest: FormRead) => Error
}) {
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)

  function createSession(): FormSession<C> {
    return { targetId: null, baseVersion: null, context: null, generation: 0, pending: null }
  }

  async function hydrate(session: FormSession<C>, id: string | null) {
    const generation = ++session.generation
    session.targetId = id
    session.baseVersion = null
    session.context = null
    session.pending = null
    const [form, context] = await Promise.all([
      id ? options.repository().loadForm(id) : Promise.resolve(null),
      options.repository().context(),
    ])
    if (session.generation === generation) {
      session.baseVersion = form?.version ?? null
      session.context = context
    }
    return { form, context }
  }

  async function saveForm(session: FormSession<C>, draft: ProjectContractFormDraft, action: F2SaveAction, attachments: ContractFormAttachmentChanges = {}) {
    if (!session.context || (draft.id && draft.id !== session.targetId))
      throw new Error('当前表单与写入目标不一致，请重新载入后保存')
    const generation = session.generation
    const id = session.targetId
    const fingerprint = JSON.stringify({
      ...(id ? { id } : {}),
      baseVersion: session.baseVersion,
      action,
      draft: { ...draft, ...(id ? { id } : {}) },
      attachments,
    })
    // 提交瞬间固定内容；请求途中编辑草稿不会改变正在发送的命令。
    const content = JSON.parse(fingerprint) as CommandContent
    if (!session.pending || session.pending.fingerprint !== fingerprint)
      session.pending = { id: crypto.randomUUID(), fingerprint }
    const commandId = session.pending.id
    try {
      const result = await options.repository().execute({
        ...content,
        workspaceId: session.context.workspaceId,
        actorId: session.context.actorId,
        requiredCapability: options.capability,
        commandId,
      })
      if (session.generation === generation && session.pending?.id === commandId) {
        session.pending = null
        session.targetId = result.id
        session.baseVersion = result.version
      }
      latestWrite.value = { id: result.id, version: result.version }
      return result
    }
    catch (cause) {
      const problem = options.problemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id)
        throw options.conflict(await options.repository().loadForm(id))
      throw problem
    }
  }

  function adoptConflictVersion(session: FormSession<C>, latest: FormRead) {
    if (latest.draft.id !== session.targetId)
      throw new Error('更新版本不属于当前合同，请重新载入')
    session.baseVersion = latest.version
    session.pending = null
  }

  return { latestWrite: readonly(latestWrite), createSession, hydrate, saveForm, adoptConflictVersion }
}
