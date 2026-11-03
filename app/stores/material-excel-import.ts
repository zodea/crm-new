import type { MaterialExcelBatchRequest, MaterialExcelDecision, MaterialExcelFile, MaterialExcelPreviewRow } from '~/lib/material-contract/excel-contract'
import { defineStore } from 'pinia'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { materialExcelBatchKey, materialExcelCommandIds } from '~/lib/material-contract/excel-batch-key'

interface PreviewBatch { workspaceId: string, actorId: string, capabilities: string[], fileHash: string, rows: MaterialExcelPreviewRow[] }
const required = ['material-contract:read', 'material-contract:write', 'material-contract:sensitive:read', 'project:list:read', 'supplier:list:read', 'construction-contract:read', 'construction-scope:read', 'our-signatory:read']
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function decodePreview(value: unknown): PreviewBatch {
  if (!isObject(value) || typeof value.workspaceId !== 'string' || !value.workspaceId || typeof value.actorId !== 'string' || !value.actorId || typeof value.fileHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.fileHash)
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string') || new Set(value.capabilities).size !== value.capabilities.length || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 200) {
    throw new Error('合同批次预览来源或行数无效')
  }
  const keys = new Set<string>()
  for (const row of value.rows) {
    if (!isObject(row) || typeof row.key !== 'string' || !row.key || keys.has(row.key) || !Number.isSafeInteger(row.rowNumber) || Number(row.rowNumber) < 2 || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint)
      || !isObject(row.draft) || !['projectName', 'supplierName', 'constructionName', 'signatoryName'].every(key => typeof row[key] === 'string') || !Array.isArray(row.lineItems) || row.lineCount !== row.lineItems.length
      || !Array.isArray(row.candidates) || !Array.isArray(row.projects) || !Array.isArray(row.suppliers) || !Array.isArray(row.signatories) || !Array.isArray(row.mains)) {
      throw new Error('合同预览行或来源无效')
    }
    keys.add(row.key)
    for (const refs of [row.projects, row.suppliers, row.signatories]) {
      const ids = new Set<string>()
      for (const ref of refs) {
        if (!isObject(ref) || typeof ref.id !== 'string' || !ref.id || ids.has(ref.id) || typeof ref.name !== 'string' || typeof ref.version !== 'string' || !ref.version)
          throw new Error('合同关联候选无效')
        ids.add(ref.id)
      }
    }
    const mains = new Set<string>()
    for (const main of row.mains) {
      if (!isObject(main) || typeof main.id !== 'string' || !main.id || mains.has(main.id) || typeof main.name !== 'string' || typeof main.no !== 'string' || typeof main.projectId !== 'string' || !main.projectId || typeof main.basis !== 'string' || !/^[a-f0-9]{64}$/.test(main.basis))
        throw new Error('施工主合同候选无效')
      mains.add(main.id)
    }
    const candidates = new Set<string>()
    for (const candidate of row.candidates) {
      if (!isObject(candidate) || typeof candidate.id !== 'string' || !candidate.id || candidates.has(candidate.id) || typeof candidate.version !== 'string' || !commandVersionAtLeast(candidate.version, candidate.version) || typeof candidate.name !== 'string' || typeof candidate.no !== 'string'
        || !Number.isSafeInteger(candidate.lineCount) || Number(candidate.lineCount) < 0 || !Number.isSafeInteger(candidate.attachmentCount) || Number(candidate.attachmentCount) < 0 || !isObject(candidate.fields) || Object.keys(candidate.fields).some(key => !Object.hasOwn(row.draft as object, key))) {
        throw new Error('已有采购合同候选无效')
      }
      candidates.add(candidate.id)
    }
  }
  return structuredClone(value) as unknown as PreviewBatch
}
export const useMaterialExcelImportStore = defineStore('material-excel-import', () => {
  const repository = () => useNuxtApp().$repositories.materialContractCommands
  const recovery = createCommandRecoveryStorage()
  const prefix = `crm:form-command:v1:${encodeURIComponent('material-excel')}:`
  let busy = false
  const authorize = (context: { workspaceId: string, actorId: string, capabilities: string[] }, original?: { workspaceId: string, actorId: string, capabilities: string[] }) => {
    if (!required.every(item => context.capabilities.includes(item)) || (original && (context.workspaceId !== original.workspaceId || context.actorId !== original.actorId || [...context.capabilities].sort().join('\0') !== [...original.capabilities].sort().join('\0'))))
      throw new Error('身份、权限或资料来源变化，请保留原批次编号')
  }
  async function recoverPending() {
    if (busy)
      throw new Error('采购合同批次正在处理，请稍候')
    busy = true
    try {
      const context = await repository().context()
      authorize(context)
      const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter((key): key is string => !!key && key.startsWith(prefix))
      let applied = 0
      let notApplied = 0
      for (const key of keys) {
        const descriptor = recovery.read(key)
        if (!descriptor || descriptor.family !== 'material-excel' || descriptor.workspaceId !== context.workspaceId || descriptor.actorId !== context.actorId || !descriptor.targetId || !/^[a-f0-9]{64}$/.test(descriptor.targetId) || descriptor.commandId !== `matx-${descriptor.targetId}` || !/^import-[0-9a-z]+~(?:n|r[a-z0-9][\w-]{2,79})(?:\.[0-9a-z]+~(?:n|r[a-z0-9][\w-]{2,79}))*$/i.test(descriptor.action))
          throw new Error('采购合同原批次身份或编号无效，请保留恢复信息')
        const entries = descriptor.action.slice(7).split('.').map(value => value.split('~'))
        const indexes = entries.map(([value]) => Number.parseInt(value!, 36))
        const ids = materialExcelCommandIds(descriptor.targetId, indexes)
        const results = []
        for (const [index, id] of ids.entries()) {
          const result = await repository().resolve(id)
          const target = entries[index]![1]!
          if (result.outcome === 'applied' && target.startsWith('r') && result.result.id !== target.slice(1))
            throw new Error('采购合同回执目标与原选择不一致')
          results.push(result)
          authorize(await repository().context(), context)
        }
        const successful = results.filter(item => item.outcome === 'applied')
        if (successful.length && successful.length !== results.length)
          throw new Error('原批次回执不一致，请停止导入并核对资料')
        for (const resolution of successful) {
          if (resolution.outcome !== 'applied')
            continue
          const form = await repository().loadForm(resolution.result.id)
          authorize(await repository().context(), context)
          if (form.draft.id !== resolution.result.id || !commandVersionAtLeast(form.version, resolution.result.version))
            throw new Error('原批次已保存，但同一合同尚未可靠读取')
        }
        recovery.clear(key, descriptor.commandId)
        if (successful.length)
          applied += successful.length
        else notApplied += ids.length
      }
      return { applied, notApplied }
    }
    finally { busy = false }
  }
  async function preview(file: MaterialExcelFile): Promise<PreviewBatch> {
    if (busy)
      throw new Error('采购合同批次正在处理，请稍候')
    busy = true
    try {
      const before = await repository().context()
      authorize(before)
      const batch = decodePreview(await $fetch('/api/commands/material-contracts/excel-preview', { method: 'POST', body: { file } }))
      const after = await repository().context()
      authorize(after, before)
      if (batch.workspaceId !== before.workspaceId || batch.actorId !== before.actorId || [...batch.capabilities].sort().join('\0') !== [...before.capabilities].sort().join('\0'))
        throw new Error('合同预览期间身份、权限或资料来源变化')
      return batch
    }
    finally { busy = false }
  }
  async function importBatch(file: MaterialExcelFile, fileHash: string, decisions: MaterialExcelDecision[]) {
    if (busy)
      throw new Error('采购合同批次正在处理，请稍候')
    busy = true
    try {
      const context = await repository().context()
      authorize(context)
      const indexes = decisions.flatMap((decision, index) => decision.kind === 'skip' ? [] : [index])
      if (!indexes.length)
        throw new Error('没有选择要导入的合同')
      const batchKey = await materialExcelBatchKey({ workspaceId: context.workspaceId, actorId: context.actorId, fileHash, fileName: file.fileName, fileSize: file.fileSize, decisions })
      const ids = materialExcelCommandIds(batchKey, indexes)
      const descriptor = { family: 'material-excel', workspaceId: context.workspaceId, actorId: context.actorId, targetId: batchKey, commandId: `matx-${batchKey}`, action: `import-${indexes.map(index => `${index.toString(36)}~${decisions[index]!.kind === 'replace' ? `r${decisions[index]!.id}` : 'n'}`).join('.')}` }
      const key = commandRecoveryKey(descriptor)
      recovery.remember(key, descriptor)
      const body: MaterialExcelBatchRequest = { workspaceId: context.workspaceId, actorId: context.actorId, file, decisions }
      const response: unknown = await $fetch('/api/commands/material-contracts/excel-import', { method: 'POST', body })
      if (!isObject(response) || response.batchKey !== batchKey || !Array.isArray(response.results) || response.results.length !== ids.length)
        throw new Error('合同批次回执不完整，请核对原批次')
      for (const [index, result] of response.results.entries()) {
        const decision = decisions[indexes[index]!]!
        if (!isObject(result) || result.commandId !== ids[index] || typeof result.id !== 'string' || !result.id || (decision.kind === 'replace' && decision.id !== result.id) || typeof result.version !== 'string' || !commandVersionAtLeast(result.version, result.version))
          throw new Error('合同批次回执与原编号不一致')
        const form = await repository().loadForm(result.id)
        authorize(await repository().context(), context)
        if (form.draft.id !== result.id || !commandVersionAtLeast(form.version, result.version))
          throw new Error('合同批次已保存，尚不能可靠读取同一合同')
      }
      recovery.clear(key, descriptor.commandId)
      return response.results.length
    }
    finally { busy = false }
  }
  return { preview, importBatch, recoverPending }
})
