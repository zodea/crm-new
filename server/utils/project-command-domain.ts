import type {
  FormAttachmentChanges,
  MasterDataSaveAction,
  ProjectFormDraft,
} from '../../app/lib/master-data/forms'
import {
  decodeProjectAttachmentChanges,
  decodeProjectFormDraft,
  ProjectCommandValidationError,
} from '../../app/lib/project/command-validation'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

function validationFailure(
  message: string,
  fieldErrors: Record<string, string[]> = {},
): never {
  throw new ProjectRepositoryProblem({
    ...projectProblem('validation-failed', message),
    fieldErrors,
  })
}

export function decodeProjectCommandContent(
  draft: unknown,
  attachments: unknown,
): { draft: ProjectFormDraft, attachments: FormAttachmentChanges } {
  try {
    const decodedDraft = decodeProjectFormDraft(draft)
    delete decodedDraft.approvalStatus
    return {
      draft: decodedDraft,
      attachments: decodeProjectAttachmentChanges(attachments),
    }
  }
  catch (cause) {
    if (cause instanceof ProjectCommandValidationError)
      return validationFailure(cause.message)
    throw cause
  }
}

export function assertProjectCommandBusinessRules(
  draft: ProjectFormDraft,
  action: MasterDataSaveAction,
): void {
  if (action === 'draft')
    return
  const required: Array<[keyof ProjectFormDraft, string]> = [
    ['name', '项目名称'],
    ['customerId', '客户'],
    ['manager', '项目经理'],
  ]
  const fieldErrors = Object.fromEntries(required
    .filter(([field]) => typeof draft[field] !== 'string' || !String(draft[field]).trim())
    .map(([field, label]) => [field, [`${label}为必填项`]]))
  if (Object.keys(fieldErrors).length)
    validationFailure('项目表单校验失败', fieldErrors)
}

export function deriveProjectApprovalStatus(
  action: MasterDataSaveAction,
  current: string | null | undefined,
): string {
  if (action === 'draft')
    return 'draft'
  if (action === 'submit')
    return 'submitted'
  return current || 'draft'
}
