import type { ConstructionMainOption } from '../../app/lib/construction-scope/contract'
import type { MaterialExcelBatchRequest, MaterialExcelDecision, MaterialExcelFile, MaterialExcelPreviewRow, MaterialExcelReference } from '../../app/lib/material-contract/excel-contract'
import type { MaterialExcelGroup } from '../../app/lib/material-contract/excel-import'
import type { OurSignatoryRecord } from '../../app/lib/our-signatory/contract'
import type { BusinessSession } from './business-session'
import type { StoredMaterialContract } from './material-contract-command-test-instance'
import { decodeConstructionMainSelection } from '../../app/lib/construction-scope/contract'
import { prepareMaterialExcelWorkbook } from '../../app/lib/material-contract/excel-import'
import { materialContractProblem, MaterialContractRepositoryProblem } from '../../app/lib/material-contract/repository'
import { parseWorkbookForMapping } from '../../app/lib/util/excel'
import { commandFingerprint } from './command-journal'
import { materialOriginalBytes } from './material-contract-original'

function invalid(message: string): never {
  throw new MaterialContractRepositoryProblem(materialContractProblem('validation-failed', message))
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function parseMaterialExcelFile(value: unknown): MaterialExcelFile {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'fileName,fileSize,payloadBase64' || typeof value.fileName !== 'string'
    || !/\.xlsx$/i.test(value.fileName) || /[/\\]/.test(value.fileName) || !Number.isSafeInteger(value.fileSize) || typeof value.payloadBase64 !== 'string') {
    return invalid('请选择有效的 Excel 工作簿')
  }
  const file = { fileName: value.fileName, fileSize: value.fileSize as number, payloadBase64: value.payloadBase64 }
  materialOriginalBytes(file, true)
  return file
}
export async function parseMaterialExcelWorkbook(file: MaterialExcelFile): Promise<MaterialExcelGroup[]> {
  const bytes = materialOriginalBytes(file, true)!
  try {
    const workbook = await parseWorkbookForMapping(Uint8Array.from(bytes).buffer)
    for (const sheet of workbook.sheets) sheet.sourceFileName = file.fileName
    const groups = prepareMaterialExcelWorkbook(workbook)
    if (groups.length > 200)
      return invalid('单个工作簿最多导入 200 份合同')
    return groups
  }
  catch (cause) {
    if (cause instanceof MaterialContractRepositoryProblem)
      throw cause
    return invalid(cause instanceof Error ? cause.message : '工作簿无法解析')
  }
}
function reference(value: unknown): MaterialExcelReference {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'id,name,version' || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || typeof value.version !== 'string' || !value.version)
    return invalid('合同关联候选无效')
  return { id: value.id, name: value.name, version: value.version }
}
export function parseMaterialExcelBatch(value: unknown): MaterialExcelBatchRequest {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'actorId,decisions,file,workspaceId' || typeof value.workspaceId !== 'string' || !value.workspaceId || typeof value.actorId !== 'string' || !value.actorId || !Array.isArray(value.decisions) || value.decisions.length > 200)
    return invalid('采购合同导入批次无效')
  const decisions: MaterialExcelDecision[] = value.decisions.map((entry: unknown) => {
    if (!object(entry) || Object.keys(entry).some(key => !['key', 'fingerprint', 'kind', 'id', 'version', 'project', 'supplier', 'signatory', 'main'].includes(key))
      || typeof entry.key !== 'string' || !entry.key || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || !['create', 'replace', 'skip'].includes(String(entry.kind))) {
      return invalid('采购合同导入确认无效')
    }
    if (entry.kind === 'skip') {
      if (Object.keys(entry).some(key => !['key', 'fingerprint', 'kind'].includes(key)))
        return invalid('跳过行不得携带关联')
      return { key: entry.key, fingerprint: entry.fingerprint, kind: 'skip' }
    }
    if (entry.kind === 'replace' ? typeof entry.id !== 'string' || !entry.id || typeof entry.version !== 'string' || !/^[1-9]\d*$/.test(entry.version) : entry.id !== undefined || entry.version !== undefined)
      return invalid('采购合同选择的身份或版本无效')
    let main
    try {
      main = decodeConstructionMainSelection(entry.main)
    }
    catch { return invalid('请选择真实施工主合同') }
    return { key: entry.key, fingerprint: entry.fingerprint, kind: entry.kind as 'create' | 'replace', ...(entry.kind === 'replace' ? { id: entry.id as string, version: entry.version as string } : {}), project: reference(entry.project), supplier: reference(entry.supplier), ...(entry.signatory !== undefined ? { signatory: reference(entry.signatory) } : {}), main }
  })
  return { workspaceId: value.workspaceId, actorId: value.actorId, file: parseMaterialExcelFile(value.file), decisions }
}

export function materialExcelPreview(groups: MaterialExcelGroup[], inputs: { contracts: readonly StoredMaterialContract[], projects: readonly MaterialExcelReference[], suppliers: readonly MaterialExcelReference[], mains: readonly ConstructionMainOption[], signatories: readonly OurSignatoryRecord[] }, actor: BusinessSession): MaterialExcelPreviewRow[] {
  if (!['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read', 'project:list:read', 'supplier:list:read', 'construction-contract:read', 'construction-scope:read', 'our-signatory:read'].every(key => actor.capabilities.includes(key)))
    throw new MaterialContractRepositoryProblem(materialContractProblem('forbidden', '采购合同预览所需来源或权限不完整'))
  const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
  return groups.map((group) => {
    const projects = inputs.projects.filter(row => normalize(row.name) === normalize(group.projectName)).map(row => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id))
    const suppliers = inputs.suppliers.filter(row => normalize(row.name) === normalize(group.supplierName)).map(row => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id))
    const signatories = group.signatoryName ? inputs.signatories.filter(row => row.draft.status === 'active' && normalize(row.draft.name) === normalize(group.signatoryName)).map(row => ({ id: row.id, name: row.draft.name, version: row.version })).sort((a, b) => a.id.localeCompare(b.id)) : []
    const mains = inputs.mains.filter(row => normalize(row.name) === normalize(group.constructionName) || normalize(row.no) === normalize(group.constructionName)).map(({ id, projectId, basis, name, no }) => ({ id, projectId, basis, name, no })).sort((a, b) => a.id.localeCompare(b.id))
    const number = String(group.draft.no ?? '').trim()
    const candidates = inputs.contracts.filter(row => !row.migrationRetired && !row.migrationEvidence?.deletedAt && !row.draft.isSupplement && ((number && number === String(row.draft.no ?? '').trim()) || normalize(group.draft.name) === normalize(row.draft.name))).map(row => ({ id: row.id, version: String(row.version), name: String(row.draft.name ?? ''), no: String(row.draft.no ?? ''), fields: Object.fromEntries(Object.keys(group.draft).map(key => [key, row.draft[key as keyof typeof row.draft] ?? null])), lineCount: row.draft.lineItems?.length ?? 0, attachmentCount: row.attachments.filter(file => !file.deletedAt).length })).sort((a, b) => a.id.localeCompare(b.id))
    const fingerprint = commandFingerprint({ group, projects, suppliers, signatories, mains, candidates: candidates.map(({ id, version }) => ({ id, version })) })
    return { key: group.key, rowNumber: group.rowNumber, draft: group.draft, projectName: group.projectName, supplierName: group.supplierName, constructionName: group.constructionName, signatoryName: group.signatoryName, lineItems: group.lineItems, lineCount: group.lineItems.length, fingerprint, candidates, projects, suppliers, signatories, mains }
  })
}
