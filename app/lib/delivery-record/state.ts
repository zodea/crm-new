import type { DeliveryRecordInput } from '../../stores/delivery-record'
import type { DataOriginDTO } from '../../types/read-model'
import type { DeliveryCentralRecord, DeliveryCommand, DeliveryCommandResult, DeliveryContext, DeliveryDraft, DeliverySourceUpload } from './contract'
import type { DeliveryRepository } from './repository'
import { computed, readonly, shallowRef } from 'vue'
import { ProjectRepositoryProblem } from '../project/repository'
import { deliveryProblem } from './contract'

function aborted(signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException('送货读取已取消', 'AbortError')
}
function draft(input: DeliveryRecordInput): DeliveryDraft {
  return { projectId: input.projectId, supplierId: input.supplierId, orderNo: input.orderNo, deliveryDate: input.deliveryDate, note: input.note, rawSiteText: input.rawSiteText ?? '', reviewFlag: input.reviewFlag ?? '', confirmations: { ...input.confirmations }, lines: input.lines.map(line => ({ ...line })) }
}
async function sourceUpload(file: File): Promise<DeliverySourceUpload> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  const mimeType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '')
  return { fileName: file.name, mimeType, fileSize: bytes.length, payloadBase64: btoa(binary) }
}
async function intentKey(command: DeliveryCommand): Promise<string> {
  const json = JSON.stringify(command, (key, value: unknown) => {
    if (key === 'commandId' || key === 'baseVersion')
      return undefined
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : value
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 浏览器状态只发布完整中央读结果；所有写入都由 Repository 提交并重新读取。 */
export function createDeliveryRecordState(repository: DeliveryRepository, originFor: () => DataOriginDTO, createId: () => string = () => crypto.randomUUID()) {
  const list = shallowRef<DeliveryCentralRecord[]>([])
  const context = shallowRef<DeliveryContext | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const sourceVersion = shallowRef('')
  const contextOrigin = shallowRef<DataOriginDTO | null>(null)
  let inFlight: { origin: DataOriginDTO, controller: AbortController, promise: Promise<void> } | null = null
  const retries = new Map<string, DeliveryCommand>()
  const operations = new Map<string, DeliveryCommandResult>()
  const byId = (id: string) => contextOrigin.value === originFor() ? list.value.find(record => record.id === id) : undefined
  const canWrite = computed(() => originFor() === 'real' && contextOrigin.value === 'real' && context.value?.capabilities.includes('delivery:write') === true)

  function cancelRead() {
    inFlight?.controller.abort()
    inFlight = null
  }
  function load(): Promise<void> {
    const origin = originFor()
    if (inFlight?.origin === origin)
      return inFlight.promise
    cancelRead()
    const controller = new AbortController()
    loading.value = true
    error.value = ''
    list.value = []
    context.value = null
    contextOrigin.value = null
    const promise = Promise.all([repository.context(origin, { signal: controller.signal }), repository.list(origin, { signal: controller.signal })])
      .then(([nextContext, result]) => {
        aborted(controller.signal)
        if (origin !== originFor())
          throw new DOMException('送货来源已变化', 'AbortError')
        context.value = nextContext
        contextOrigin.value = origin
        list.value = result.records.filter(record => record.archived)
        sourceVersion.value = result.sourceVersion
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          list.value = []
          context.value = null
          contextOrigin.value = null
          error.value = cause instanceof Error ? cause.message : '送货读取失败'
        }
        throw cause
      })
      .finally(() => {
        if (inFlight?.controller === controller) {
          inFlight = null
          loading.value = false
        }
      })
    inFlight = { origin, controller, promise }
    return promise
  }
  async function envelope() {
    if (!context.value || contextOrigin.value !== originFor())
      await load()
    if (!context.value || !canWrite.value)
      throw deliveryProblem('forbidden', '当前来源或权限不允许修改送货记录')
    return { workspaceId: context.value.workspaceId, actorId: context.value.actorId, origin: 'real' as const, requiredCapability: 'delivery:write' as const }
  }
  async function mutate(command: DeliveryCommand): Promise<DeliveryCommandResult> {
    if (!canWrite.value || command.origin !== originFor() || command.workspaceId !== context.value?.workspaceId || command.actorId !== context.value?.actorId)
      throw deliveryProblem('forbidden', '送货来源或会话已变化，请重新读取后保存')
    if (saving.value)
      throw deliveryProblem('conflict', '送货保存仍在进行，请稍后重试')
    saving.value = true
    try {
      const key = await intentKey(command)
      if (!canWrite.value || command.origin !== originFor())
        throw deliveryProblem('forbidden', '送货来源已变化，请重新读取后保存')
      const request = retries.get(key) ?? { ...command, commandId: createId() }
      retries.set(key, request)
      let result: DeliveryCommandResult
      try {
        result = await repository.execute(request)
      }
      catch (cause) {
        if (cause instanceof ProjectRepositoryProblem && cause.problem.code === 'conflict')
          retries.delete(key)
        throw cause
      }
      operations.set(result.revisionId, result)
      cancelRead()
      await load()
      retries.delete(key)
      return result
    }
    finally {
      saving.value = false
    }
  }
  async function existing(id: string, baseVersion?: string) {
    const identity = await envelope()
    const record = byId(id) ?? await repository.detail(id, 'real')
    return { ...identity, commandId: '', id, baseVersion: baseVersion ?? record.version }
  }
  async function print(ids: readonly string[], disposition: 'printed' | 'excluded') {
    if (!ids.length)
      return
    const identity = await envelope()
    const targets = await Promise.all(ids.map(async (id) => {
      const record = byId(id) ?? await repository.detail(id, 'real')
      return { id, baseVersion: record.version }
    }))
    await mutate({ ...identity, commandId: '', action: 'print', targets, disposition })
  }
  return {
    mode: 'central' as const,
    origin: computed(originFor),
    list: readonly(list),
    context: readonly(context),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    sourceVersion: readonly(sourceVersion),
    canWrite,
    load,
    byId,
    cancelRead,
    pendingPrintRecords: computed(() => list.value.filter(record => record.printDisposition === 'pending')),
    async add(input: DeliveryRecordInput, sourceFile?: File) {
      const requestedDraft = draft(input)
      const uploadBatchId = input.printBatchId ?? null
      const identity = await envelope()
      const source = sourceFile ? await sourceUpload(sourceFile) : null
      const result = await mutate({ ...identity, action: 'archive', commandId: '', baseVersion: null, uploadBatchId, source, draft: requestedDraft })
      return result.id
    },
    async update(id: string, input: DeliveryRecordInput, reason = '', baseVersion?: string) {
      const requestedDraft = draft(input)
      const result = await mutate({ ...await existing(id, baseVersion), action: 'revise', reason, draft: requestedDraft })
      return result.revisionId
    },
    async remove(id: string) {
      return (await mutate({ ...await existing(id), action: 'delete', reason: '人工确认删除送货记录' })).revisionId
    },
    async restore(id: string, baseVersion = '') {
      return (await mutate({ ...await envelope(), commandId: '', id, baseVersion, action: 'restore', reason: '人工确认恢复送货记录' })).revisionId
    },
    async undo(revisionId: string): Promise<boolean> {
      const operation = operations.get(revisionId)
      if (!operation)
        return false
      await mutate({ ...await envelope(), commandId: '', id: operation.id, baseVersion: operation.version, action: 'undo', revisionId, reason: '人工撤回刚才的操作' })
      return true
    },
    excludeFromPrint: (id: string) => print([id], 'excluded'),
    excludeManyFromPrint: (ids: readonly string[]) => print(ids, 'excluded'),
    confirmPrintReceipt: (id: string) => print([id], 'printed'),
    confirmManyPrintReceipts: (ids: readonly string[]) => print(ids, 'printed'),
    history: (id: string, options?: { signal?: AbortSignal }) => repository.history(id, originFor(), options),
    async loadSourceFile(id: string, options?: { signal?: AbortSignal, assetId?: string | null }) {
      const origin = originFor()
      const assertCurrent = () => {
        if (options?.signal?.aborted || origin !== originFor())
          throw new DOMException('送货原件读取已取消或来源已变化', 'AbortError')
      }
      assertCurrent()
      const record = await repository.detail(id, origin, options)
      assertCurrent()
      const assetId = options?.assetId === undefined ? record.assetId : options.assetId
      if (!assetId)
        return null
      const source = await repository.fileContent({ id, assetId, origin, projectId: record.projectId, supplierId: record.supplierId }, options)
      assertCurrent()
      return source
    },
    async saveSourceFile(id: string, file: File, reason = '', baseVersion?: string) {
      const identity = await existing(id, baseVersion)
      await mutate({ ...identity, action: 'source', source: await sourceUpload(file), reason })
    },
  }
}
