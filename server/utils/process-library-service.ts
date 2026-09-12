import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { ProcessLibraryCatalog, ProcessLibraryCommandResult, ProcessLibraryCreateCommand, ProcessLibraryVersion } from '../../app/lib/schedule/process-library-contract'
import type { DataOriginDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import { PROCESS_LIBRARY_READ_CAPABILITY, PROCESS_LIBRARY_WRITE_CAPABILITY, processLibraryProblem } from '../../app/lib/schedule/process-library-contract'
import { normalizeProcessLibraryDraft } from '../../app/lib/schedule/process-library-domain'
import { prepareProcessLibraryMigration } from './process-library-migration'
import { parseProcessLibraryCommand } from './process-library-request'

interface LibraryState {
  versions: ProcessLibraryVersion[]
  commands: Map<string, { fingerprint: string, result: ProcessLibraryCommandResult }>
  revision: number
}
interface Options {
  createId?: () => string
  now?: () => string
  beforeCommit?: () => void
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : entry)
}

/** 当前中央验证实例；只发布完整版本，不承担生产持久化。 */
export function createProcessLibraryService(options: Options = {}) {
  const states = new Map<string, LibraryState>()
  const createId = options.createId ?? randomUUID
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (session: BusinessSession, sessionId?: string | null) => JSON.stringify([session.workspaceId, sessionId || 'default'])
  function stateFor(session: BusinessSession, sessionId?: string | null): LibraryState {
    const key = keyFor(session, sessionId)
    const state = states.get(key) ?? { versions: [], commands: new Map(), revision: 0 }
    states.set(key, state)
    return state
  }
  function authorize(session: BusinessSession, origin: DataOriginDTO, write = false) {
    if (!session.capabilities.includes(PROCESS_LIBRARY_READ_CAPABILITY)
      || (write && !session.capabilities.includes(PROCESS_LIBRARY_WRITE_CAPABILITY))) {
      throw processLibraryProblem('forbidden', '无工序库读取或维护权限')
    }
    if (origin === 'demo' && (write || !session.capabilities.includes('demo:read')))
      throw processLibraryProblem('forbidden', '演示来源只能在授权后读取，不能保存版本')
  }
  function visible(record: ProcessLibraryVersion): ProcessLibraryVersion {
    const result = structuredClone(record)
    result.tasks = result.tasks.filter(task => !task.deletedAt)
    result.taskCount = result.tasks.length
    result.usageCount = null
    return result
  }
  function detail(id: string, origin: DataOriginDTO, session: BusinessSession, sessionId?: string | null) {
    authorize(session, origin)
    const record = stateFor(session, sessionId).versions.find(row => row.id === id && row.dataOrigin === origin && !row.deletedAt)
    if (!record)
      throw processLibraryProblem('not-found', '该来源的工序库版本不存在或已删除')
    return visible(record)
  }
  return {
    detail,
    /** 仅由非生产测试端点调用；正常恢复必须走迁移依赖校验。 */
    resetTestSession(session: BusinessSession, sessionId: string): void {
      states.delete(keyFor(session, sessionId))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, session: BusinessSession, sessionId?: string | null): () => void {
      const state = stateFor(session, sessionId)
      const candidate = prepareProcessLibraryMigration(state.versions, snapshot)
      return () => {
        if (!candidate.changed)
          return
        state.versions = candidate.versions
        state.revision += 1
      }
    },
    catalog(origin: DataOriginDTO, session: BusinessSession, sessionId?: string | null): ProcessLibraryCatalog {
      authorize(session, origin)
      const state = stateFor(session, sessionId)
      return {
        origin,
        workspaceId: session.workspaceId,
        actorId: session.actorId,
        capabilities: session.capabilities.filter(capability => origin === 'real' || capability !== PROCESS_LIBRARY_WRITE_CAPABILITY),
        sourceVersion: String(state.revision),
        seriesVersions: Object.fromEntries([...new Set(state.versions.filter(row => row.dataOrigin === origin).map(row => row.code))]
          .map(code => [code, Math.max(...state.versions.filter(row => row.dataOrigin === origin && row.code === code).map(row => row.version))])),
        libraries: state.versions.filter(row => row.dataOrigin === origin && !row.deletedAt)
          .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.sortOrder - right.sortOrder || left.code.localeCompare(right.code) || right.version - left.version)
          .map((row) => {
            const { tasks: _tasks, ...summary } = visible(row)
            return summary
          }),
      }
    },
    execute(input: ProcessLibraryCreateCommand, session: BusinessSession, sessionId?: string | null): ProcessLibraryCommandResult {
      const command = parseProcessLibraryCommand(input)
      authorize(session, command.origin, true)
      if (command.workspaceId !== session.workspaceId || command.actorId !== session.actorId)
        throw processLibraryProblem('forbidden', '工序库保存会话身份已变化，请重新读取')
      const state = stateFor(session, sessionId)
      const fingerprint = canonical(command)
      const prior = state.commands.get(command.commandId)
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw processLibraryProblem('conflict', '同一提交重复使用了不同内容，请重新核对')
        detail(prior.result.id, command.origin, session, sessionId)
        return structuredClone(prior.result)
      }
      let draft: ReturnType<typeof normalizeProcessLibraryDraft>
      try {
        draft = normalizeProcessLibraryDraft(command.draft)
      }
      catch (cause) {
        throw processLibraryProblem('validation-failed', cause instanceof Error ? cause.message : '工序库字段无效')
      }
      const latest = Math.max(0, ...state.versions.filter(row => row.dataOrigin === command.origin && row.code === draft.code).map(row => row.version))
      if (latest !== command.baseVersion)
        throw processLibraryProblem('conflict', '该编码已有更新版本，请保留草稿并重新核对版本')
      if (draft.sourceLibraryId) {
        const source = detail(draft.sourceLibraryId, command.origin, session, sessionId)
        if (source.code !== draft.code)
          throw processLibraryProblem('relationship-mismatch', '基于旧版新建时不能修改工序库编码')
        if (source.sourceVersion !== command.sourceVersion)
          throw processLibraryProblem('conflict', '来源版本已变化，请重新读取后核对')
      }
      else if (latest || command.sourceVersion !== null) {
        throw processLibraryProblem('conflict', '工序库编码已存在，请基于已保存版本新建下一版')
      }
      const id = createId()
      const version = latest + 1
      const timestamp = now()
      const record: ProcessLibraryVersion = {
        id,
        code: draft.code,
        name: draft.name,
        description: draft.description,
        version,
        sourceVersion: String(version),
        sourceVersionId: draft.sourceLibraryId,
        dataOrigin: command.origin,
        isDefault: false,
        sortOrder: Math.max(0, ...state.versions.map(row => row.sortOrder)) + 10,
        taskCount: draft.tasks.length,
        usageCount: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: session.actorId,
        deletedAt: null,
        migrationBatchId: null,
        legacyId: null,
        tasks: draft.tasks.map((task, index) => ({
          ...task,
          itemCodes: [...task.itemCodes],
          id: createId(),
          libraryId: id,
          libraryVersion: version,
          sortOrder: (index + 1) * 10,
          predecessorDisabled: task.predecessorDisabled === true,
          legacyId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        })),
      }
      const result = { commandId: command.commandId, id, version, sourceVersion: record.sourceVersion }
      options.beforeCommit?.()
      state.versions = [...state.versions, record]
      state.commands.set(command.commandId, { fingerprint, result })
      state.revision += 1
      return structuredClone(result)
    },
  }
}
