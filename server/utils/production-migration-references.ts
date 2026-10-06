import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { SupplierFormDraft } from '../../app/lib/master-data/forms'
import type { BusinessSession } from './business-session'
import type { ProjectRow } from './production-project-record'
import { MigrationEvidenceProblem } from './migration-snapshot'
import { projectDraft } from './production-project-record'
import { parseSupplierCommandRequest } from './supplier-command-request'

export type MigrationReferenceType = 'projects' | 'suppliers'
export interface ProductionMigrationReference {
  entityType: MigrationReferenceType
  serverId: string
  label: string
  version: string
  sourceVersion: string
}
function fail(code: ConstructorParameters<typeof MigrationEvidenceProblem>[0], message: string): never {
  throw new MigrationEvidenceProblem(code, message)
}
const stableId = (id: string) => typeof id === 'string' && /^[A-Z0-9][\w-]{2,79}$/i.test(id)

async function authorize(tx: TransactionDb, actor: BusinessSession, type: MigrationReferenceType) {
  const domain = type === 'projects' ? 'project' : 'supplier'
  if (!actor.capabilities.includes(`${domain}:list:read`))
    return fail('forbidden', '当前身份无所选迁入关联目录的读取权限。')
  const identity = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  if (!identity || identity.workspace_id !== actor.workspaceId || identity.owner_id !== actor.actorId)
    return fail('forbidden', '迁入关联目录与当前工作区或操作者不一致。')
  const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', [domain]))[0]
  if (participant?.schema_version !== 1)
    return fail('unavailable', '迁入关联目录尚无真实正式参与者，不能使用开发数据替代。')
  const revision = await tx.select<{ revision: number }>(`SELECT revision FROM ${domain}_revision WHERE singleton=1`)
  if (revision.length !== 1 || !Number.isSafeInteger(revision[0]!.revision) || revision[0]!.revision < 0)
    return fail('unavailable', '迁入关联目录缺少当前实际读取版本。')
  return `${type}:${revision[0]!.revision}`
}

/** Actual master record versions in this same transaction; no fuzzy identity matching. */
export async function listMigrationReferences(tx: TransactionDb, actor: BusinessSession, type: MigrationReferenceType): Promise<ProductionMigrationReference[]> {
  const sourceVersion = await authorize(tx, actor, type)
  if (type === 'projects') {
    return (await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY id')).flatMap((row) => {
      if (!stableId(row.id))
        return fail('unavailable', '项目稳定身份损坏，不能作为映射依据。')
      const draft = projectDraft(row)
      return [{ entityType: type, serverId: row.id, label: draft.name ?? '', version: String(row.version), sourceVersion }]
    })
  }
  return (await tx.select<{ id: string, draft_json: string, version: number, updated_at: string }>('SELECT id,draft_json,version,updated_at FROM suppliers ORDER BY id')).flatMap((row) => {
    let draft: SupplierFormDraft
    try {
      draft = JSON.parse(row.draft_json)
      if (!stableId(row.id) || draft.id !== row.id || typeof draft.name !== 'string' || !draft.name.trim() || !Number.isSafeInteger(row.version) || row.version < 1 || !Number.isFinite(Date.parse(row.updated_at)))
        return fail('unavailable', '分供方稳定身份、原记录或当前版本损坏。')
      parseSupplierCommandRequest({ id: row.id, workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'supplier:write', commandId: 'validate-migration-reference', baseVersion: String(row.version), action: 'draft', attachments: {}, draft }, row.id)
    }
    catch { return fail('unavailable', '分供方原记录无法核实，不能按名称生成对应。') }
    return [{ entityType: type, serverId: row.id, label: draft.name!, version: String(row.version), sourceVersion }]
  })
}

export async function readMigrationReference(tx: TransactionDb, actor: BusinessSession, type: MigrationReferenceType, id: string): Promise<ProductionMigrationReference | null> {
  if (!stableId(id))
    return fail('validation-failed', '迁入目标稳定身份无效。')
  return (await listMigrationReferences(tx, actor, type)).find(row => row.serverId === id) ?? null
}
