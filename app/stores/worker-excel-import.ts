import type { CrewWorkerCommandContextDTO } from '~/lib/crew-worker/command-contract'
import type { WorkerExcelDecision, WorkerExcelImportCommand } from '~/lib/crew-worker/worker-excel-contract'
import { defineStore } from 'pinia'
import { normalizeWorkerExcelRow } from '~/lib/crew-worker/worker-excel-import'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'

const decisionKey = Symbol('worker-excel-decision')
const sourceKey = Symbol('worker-excel-source')
type Row = Record<string, unknown>
export function bindWorkerExcelRow(row: Row, decision: WorkerExcelDecision, source: string) {
  Object.defineProperty(row, decisionKey, { value: decision, configurable: true })
  Object.defineProperty(row, sourceKey, { value: source, configurable: true })
}
export async function workerExcelSourceKey(hash: string, sheet: string, rowNumber: number): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(hash) || !sheet.trim() || !Number.isSafeInteger(rowNumber) || rowNumber < 1)
    throw new Error('导入文件来源不完整，请重新选择文件')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([hash, sheet, rowNumber])))
  return `import-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export const useWorkerExcelImportStore = defineStore('worker-excel-import', () => {
  const repository = () => useNuxtApp().$repositories.crewWorkerCommands
  const recovery = createCommandRecoveryStorage()
  const prefix = `crm:form-command:v1:${encodeURIComponent('worker-excel')}:`
  let rows = new WeakMap<Row, WorkerExcelImportCommand>()
  const activeRows = new WeakSet<Row>()
  let active = 0
  let recovering = false
  function authorize(context: CrewWorkerCommandContextDTO, original?: CrewWorkerCommandContextDTO) {
    if (!context.capabilities.includes('worker:write') || !context.capabilities.includes('crew:list:read') || !context.capabilities.includes('worker:list:read') || !context.capabilities.includes('worker:sensitive:read') || (original && (context.workspaceId !== original.workspaceId || context.actorId !== original.actorId || [...context.capabilities].sort().join('\0') !== [...original.capabilities].sort().join('\0'))))
      throw new Error('身份、权限或资料来源变化，请保留原提交编号')
  }
  async function recoverPending() {
    if (active || recovering)
      throw new Error('已有工人导入正在处理，请等待当前结果')
    recovering = true
    try {
      const context = await repository().context()
      authorize(context)
      const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter((key): key is string => !!key && key.startsWith(prefix))
      let applied = 0
      let notApplied = 0
      for (const key of keys) {
        const descriptor = recovery.read(key)
        if (!descriptor || descriptor.family !== 'worker-excel' || descriptor.action !== 'import' || !descriptor.targetId || !/^import-[a-f0-9]{64}$/.test(descriptor.targetId) || descriptor.workspaceId !== context.workspaceId || descriptor.actorId !== context.actorId)
          throw new Error('原导入编号或身份不一致，请保留恢复信息')
        const resolved = await repository().resolveWorker(descriptor.commandId)
        authorize(await repository().context(), context)
        if (resolved.outcome === 'applied') {
          if (resolved.result.commandId !== descriptor.commandId)
            throw new Error('工人原回执编号不一致')
          const form = await repository().loadWorkerForm(resolved.result.id)
          authorize(await repository().context(), context)
          if (form.draft.id !== resolved.result.id || !commandVersionAtLeast(form.version, resolved.result.version))
            throw new Error('工人已保存，但同一资料尚未可靠读取')
          applied++
        }
        else { notApplied++ }
        recovery.clear(key, descriptor.commandId)
      }
      rows = new WeakMap()
      return { applied, notApplied }
    }
    finally { recovering = false }
  }
  async function importRow(row: Row) {
    if (recovering || activeRows.has(row))
      throw new Error('该工人导入正在处理，请等待当前结果')
    activeRows.add(row)
    active++
    try {
      let request = rows.get(row)
      const context = await repository().context()
      authorize(context)
      const source = (row as Record<PropertyKey, unknown>)[sourceKey]
      const decision = (row as Record<PropertyKey, unknown>)[decisionKey] as WorkerExcelDecision | undefined
      if (typeof source !== 'string' || !/^import-[a-f0-9]{64}$/.test(source) || !decision)
        throw new Error('缺少工人来源或确认结果，请重新预览')
      const descriptor = { family: 'worker-excel', workspaceId: context.workspaceId, actorId: context.actorId, targetId: source, action: 'import', commandId: request?.commandId ?? crypto.randomUUID() }
      const key = commandRecoveryKey(descriptor)
      if (!request) {
        request = { workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: 'worker:write', commandId: descriptor.commandId, draft: normalizeWorkerExcelRow(row), decision }
        recovery.remember(key, descriptor)
        rows.set(row, request)
      }
      else {
        if (request.workspaceId !== context.workspaceId || request.actorId !== context.actorId)
          throw new Error('导入身份已变化，请保留原提交编号')
        recovery.verify(key, request.commandId)
      }
      const saved = await repository().importWorkerExcel(request)
      if (saved.commandId !== request.commandId || (request.decision.kind === 'replace' && request.decision.id !== saved.id))
        throw new Error('工人导入回执与原提交不一致')
      const form = await repository().loadWorkerForm(saved.id)
      authorize(await repository().context(), context)
      if (form.draft.id !== saved.id || !commandVersionAtLeast(form.version, saved.version))
        throw new Error('工人已保存，但同一资料尚未可靠读取')
      recovery.clear(key, request.commandId)
      rows.delete(row)
    }
    finally {
      activeRows.delete(row)
      active--
    }
  }
  return { recoverPending, importRow }
})
