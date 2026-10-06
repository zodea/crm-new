import type { ProjectContractFormDraft } from '~/lib/contract/forms'
import { randomUUID } from 'node:crypto'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { ourSignatoryRuntime } from '../../server/utils/our-signatory-runtime'

/** Real isolated SQL catalog preparation; no implicit company or name mapping in the owner. */
export async function prepareVerifiedSignatory(scope: string, name: string): Promise<Pick<ProjectContractFormDraft, 'ourSignatoryId' | 'ourSignatoryVersion' | 'ourSignatorySnapshot'>> {
  const actor = resolveBusinessSession()
  const service = ourSignatoryRuntime(scope).signatories
  const created = await service.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'our-signatory:write', commandId: randomUUID(), baseVersion: null, draft: { name, taxNo: null, registeredAddress: null, legalRepresentative: null, verificationNote: '已明确核实的此用例原文书主体', status: 'active' } }, () => actor)
  const record = (await service.list(() => actor)).records.find(row => row.id === created.id)
  if (!record || record.version !== created.version || record.draft.name !== name)
    throw new Error('SQL目录未读回本次明确核实的主体')
  const { status: _status, ...facts } = record.draft
  return { ourSignatoryId: record.id, ourSignatoryVersion: record.version, ourSignatorySnapshot: { id: record.id, version: record.version, ...facts } }
}
