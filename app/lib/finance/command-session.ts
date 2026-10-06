import type { RecoveryStorage } from '../forms/command-recovery'
import type { FileRefChanges } from '../forms/file-refs'
import type { CentralFinanceKind, FinanceCommandAction, FinanceContext, FinanceFormRead, FinanceRepository } from './central-contract'
import type { F3FormDraft } from './forms'
import { createFormCommandActions } from '../forms/command-session'
import { hasConsistentReadMeta } from '../read-model/meta'
import { financeFileHash } from './attachment-proof'
import { FINANCE_FAMILIES, FINANCE_READ_SCHEMA, financeFailure, financeProblemFromUnknown } from './central-contract'

export function assertFinanceInputFinite(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value))
    financeFailure('validation-failed', '财务数值无效，不能把未知数值转换为零。')
  if (Array.isArray(value))
    value.forEach(assertFinanceInputFinite)
  else if (value && typeof value === 'object')
    Object.values(value).forEach(assertFinanceInputFinite)
}
export function createFinanceCommandActions<K extends CentralFinanceKind>(kind: K, repository: () => FinanceRepository, recoveryStorage?: () => RecoveryStorage) {
  const actions = createFormCommandActions<FinanceContext, string, F3FormDraft, FinanceCommandAction, FileRefChanges, FinanceFormRead<K>>({
    repository: () => ({
      context: () => repository().context(kind),
      loadForm: async (id: string) => {
        const form = await repository().form(kind, id)
        for (const file of form.attachments) {
          if (file.deletedAt || !file.sha256)
            continue
          const content = await repository().original(kind, id, file.id)
          if (content.bytes.length !== file.fileSize || await financeFileHash(content.bytes) !== file.sha256)
            financeFailure('unavailable', '已保存财务原件正文尚未可靠读取，请保留原编号并只重试读取。')
        }
        return form
      },
      execute: request => repository().execute({ ...request, kind }),
      resolve: (commandId: string) => repository().resolve(kind, commandId),
    }),
    capability: `${FINANCE_FAMILIES[kind]}:write`,
    problemFromUnknown: financeProblemFromUnknown,
    conflict: latest => Object.assign(new Error('财务记录已更新，请保留输入并核对最新版本。'), { latest }),
    validateReadContext: (form, context) => {
      if (!hasConsistentReadMeta(form, FINANCE_READ_SCHEMA, 'real') || !hasConsistentReadMeta(context, FINANCE_READ_SCHEMA, 'real')
        || form.workspaceId !== context.workspaceId || form.actorId !== context.actorId || form.dataOrigin !== context.dataOrigin
        || !form.capabilities.includes(`${FINANCE_FAMILIES[kind]}:read`) || !form.capabilities.includes(`${FINANCE_FAMILIES[kind]}:write`)
        || JSON.stringify(form.capabilities) !== JSON.stringify(context.capabilities)) {
        financeFailure('unavailable', '财务读取不属于当前工作区、身份或权限范围，请保留输入与原提交编号。')
      }
    },
    recoveryStorage,
  })
  async function saveForm(session: Parameters<typeof actions.saveForm>[0], draft: F3FormDraft, action: Parameters<typeof actions.saveForm>[2], attachments: Parameters<typeof actions.saveForm>[3] = {}) {
    assertFinanceInputFinite(draft)
    assertFinanceInputFinite(attachments)
    return actions.saveForm(session, draft, action, attachments)
  }
  return { ...actions, saveForm }
}

export type FinanceFormSession = ReturnType<ReturnType<typeof createFinanceCommandActions>['createSession']>
