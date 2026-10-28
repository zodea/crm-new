import type { DataOriginDTO } from '../../types/read-model'
import type { ScheduleProcessLibraryVersionDraft } from './process-library'
import type { ProcessLibraryCatalog, ProcessLibraryCommandResult, ProcessLibraryCreateCommand, ProcessLibraryVersion } from './process-library-contract'
import { computed, readonly, shallowRef } from 'vue'
import { ProjectRepositoryProblem } from '../project/repository'
import { PROCESS_LIBRARY_WRITE_CAPABILITY, processLibraryProblem } from './process-library-contract'
import { normalizeProcessLibraryDraft } from './process-library-domain'

interface ProcessLibraryPort {
  list: (origin: DataOriginDTO, options?: { signal?: AbortSignal }) => Promise<ProcessLibraryCatalog>
  detail: (id: string, origin: DataOriginDTO, options?: { signal?: AbortSignal }) => Promise<ProcessLibraryVersion>
  execute: (command: ProcessLibraryCreateCommand) => Promise<ProcessLibraryCommandResult>
}

/** 表单保留这次读取的基准；其他页签刷新列表不会抬高它。 */
export interface ProcessLibraryReadVersion {
  sequence: number
  origin: DataOriginDTO
  workspaceId: string
  actorId: string
  versions: Readonly<Record<string, number>>
  sourceLibraryId: string | null
  sourceVersion: string | null
}

export function createProcessLibraryState(repository: ProcessLibraryPort, originFor: () => DataOriginDTO, createId: () => string = () => crypto.randomUUID()) {
  const context = shallowRef<ProcessLibraryCatalog | null>(null)
  const detail = shallowRef<ProcessLibraryVersion | null>(null)
  const loading = shallowRef(false)
  const writeReady = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const readVersion = shallowRef<ProcessLibraryReadVersion | null>(null)
  const conflict = shallowRef(false)
  let sequence = 0
  let controller: AbortController | null = null
  const blockedReads = new Set<number>()
  const retries = new Map<string, ProcessLibraryCreateCommand>()
  const libraries = computed(() => context.value?.origin === originFor() ? context.value.libraries : [])
  const canWrite = computed(() => writeReady.value && originFor() === 'real' && !loading.value && context.value?.origin === 'real' && context.value.capabilities.includes(PROCESS_LIBRARY_WRITE_CAPABILITY))

  function cancelRead() {
    sequence++
    controller?.abort()
    controller = null
    loading.value = false
    writeReady.value = false
  }

  async function read(id: string | null) {
    cancelRead()
    const generation = sequence
    const origin = originFor()
    const request = new AbortController()
    controller = request
    loading.value = true
    error.value = ''
    // 目录始终是同来源全局集合，详情按 id 隔离；缓存列表不能因详情往返而卸载。
    if (context.value?.origin !== origin)
      context.value = null
    if (!context.value || detail.value?.id !== id || detail.value?.dataOrigin !== origin)
      detail.value = null
    readVersion.value = null
    const assertCurrent = () => {
      if (request.signal.aborted || generation !== sequence || origin !== originFor())
        throw new DOMException('工序库来源或读取目标已变化', 'AbortError')
    }
    try {
      const [catalog, version] = await Promise.all([
        repository.list(origin, { signal: request.signal }),
        id ? repository.detail(id, origin, { signal: request.signal }) : null,
      ])
      assertCurrent()
      if (catalog.origin !== origin || (version && (version.id !== id || version.dataOrigin !== origin)))
        throw processLibraryProblem('unavailable', '工序库返回了不匹配的来源或版本')
      context.value = catalog
      detail.value = version
      readVersion.value = {
        sequence: generation,
        origin,
        workspaceId: catalog.workspaceId,
        actorId: catalog.actorId,
        versions: { ...catalog.seriesVersions },
        sourceLibraryId: version?.id ?? null,
        sourceVersion: version?.sourceVersion ?? null,
      }
      writeReady.value = true
      return version
    }
    catch (cause) {
      if (generation === sequence && origin === originFor() && !request.signal.aborted) {
        if (cause instanceof ProjectRepositoryProblem && !['unavailable', 'internal-error'].includes(cause.problem.code)) {
          context.value = null
          detail.value = null
        }
        error.value = cause instanceof Error ? cause.message : '标准工序库读取失败'
      }
      throw cause
    }
    finally {
      if (generation === sequence) {
        loading.value = false
        controller = null
      }
    }
  }

  async function saveVersion(input: ScheduleProcessLibraryVersionDraft, baseline: ProcessLibraryReadVersion | null = readVersion.value) {
    if (!baseline || !canWrite.value || baseline.origin !== originFor() || baseline.actorId !== context.value?.actorId || baseline.workspaceId !== context.value.workspaceId)
      throw processLibraryProblem('forbidden', '尚未读取当前来源及写入权限，请重新核对后保存')
    if (blockedReads.has(baseline.sequence))
      throw processLibraryProblem('conflict', '同编码版本已变化，请重新核对当前版本系列后再保存')
    if (saving.value)
      throw processLibraryProblem('conflict', '版本仍在保存，请稍后重试')
    const draft = normalizeProcessLibraryDraft(input)
    if ((draft.sourceLibraryId ?? null) !== baseline.sourceLibraryId)
      throw processLibraryProblem('conflict', '复制来源与已读版本不一致，请重新核对')
    const envelope = {
      action: 'create-version' as const,
      workspaceId: baseline.workspaceId,
      actorId: baseline.actorId,
      origin: baseline.origin,
      requiredCapability: PROCESS_LIBRARY_WRITE_CAPABILITY,
      baseVersion: Object.hasOwn(baseline.versions, draft.code) ? baseline.versions[draft.code]! : 0,
      sourceVersion: baseline.sourceVersion,
      draft,
    }
    // 网络不确定后即使重读到更高版本，也要恢复原命令，不得把同意图再创建一版。
    const key = JSON.stringify({ ...envelope, baseVersion: undefined })
    const command = retries.get(key) ?? { ...envelope, commandId: createId() }
    retries.set(key, command)
    saving.value = true
    error.value = ''
    const requestSequence = sequence
    const assertCurrent = () => {
      if (requestSequence !== sequence || baseline.origin !== originFor() || baseline.actorId !== context.value?.actorId || baseline.workspaceId !== context.value?.workspaceId)
        throw new DOMException('工序库保存完成后读取目标已变化，请返回对应版本查看', 'AbortError')
    }
    try {
      const result = await repository.execute(command)
      assertCurrent()
      const created = await repository.detail(result.id, baseline.origin)
      assertCurrent()
      detail.value = created
      retries.delete(key)
      conflict.value = false
      return created
    }
    catch (cause) {
      if (cause instanceof ProjectRepositoryProblem && cause.problem.code === 'conflict') {
        retries.delete(key)
        blockedReads.add(baseline.sequence)
        if (requestSequence === sequence && baseline.origin === originFor())
          conflict.value = true
      }
      if (requestSequence === sequence && baseline.origin === originFor())
        error.value = cause instanceof Error ? cause.message : '标准工序库保存失败'
      throw cause
    }
    finally {
      saving.value = false
    }
  }

  return {
    origin: computed(originFor),
    context: readonly(context),
    libraries,
    detail: computed(() => detail.value?.dataOrigin === originFor() ? readonly(detail.value) : null),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    readVersion: readonly(readVersion),
    conflict: readonly(conflict),
    canWrite,
    cancelRead,
    saveVersion,
    async loadLibraries() { await read(null) },
    loadDetail: (id: string) => read(id),
    async recheckSeries(code: string, sourceId: string | null) {
      const version = await read(sourceId)
      if (version && version.code !== code)
        throw processLibraryProblem('conflict', '重新读取的来源编码不匹配')
      conflict.value = false
      return readVersion.value
    },
  }
}
