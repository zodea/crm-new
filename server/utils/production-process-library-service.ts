import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { DataOriginDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import type { ProcessLibraryState } from './process-library-service'
import type { ProductionStorage } from './production-storage'
import { randomUUID } from 'node:crypto'
import { PROCESS_LIBRARY_READ_CAPABILITY, PROCESS_LIBRARY_WRITE_CAPABILITY, processLibraryProblem } from '../../app/lib/schedule/process-library-contract'
import { parseProcessLibraryCommand } from './process-library-request'
import { createProcessLibraryService, processLibraryCanonical } from './process-library-service'
import { processLibraryDigest, readProductionProcessLibraryState } from './production-process-library-record'

type Session = () => BusinessSession
export function createProductionProcessLibraryService(storage: ProductionStorage) {
  function authorize(session: Session, write: boolean) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId
      || !actor.capabilities.includes(PROCESS_LIBRARY_READ_CAPABILITY) || (write && !actor.capabilities.includes(PROCESS_LIBRARY_WRITE_CAPABILITY))) {
      throw processLibraryProblem('forbidden', '当前会话没有此工作区的工序库权限。')
    }
    return actor
  }
  async function run<T>(origin: DataOriginDTO, session: Session, write: boolean, work: (tx: TransactionDb, actor: BusinessSession, state: ProcessLibraryState) => Promise<T>): Promise<T> {
    if (origin !== 'real')
      throw processLibraryProblem('forbidden', '正式工序库不能读取或写入演示来源。')
    const actor = authorize(session, write)
    if (write)
      storage.assertBusinessWrite()
    return storage.withTransaction(async (tx) => {
      const state = await readProductionProcessLibraryState(tx, storage.identity)
      const result = await work(tx, actor, state)
      if (processLibraryCanonical(authorize(session, write)) !== processLibraryCanonical(actor))
        throw processLibraryProblem('forbidden', '操作期间身份或权限变化，本次工序库提交已撤回。')
      return result
    })
  }
  return {
    catalog: (origin: DataOriginDTO, session: Session) => run(origin, session, false, async (_tx, actor, state) => createProcessLibraryService({ state }).catalog(origin, actor)),
    detail: (id: string, origin: DataOriginDTO, session: Session) => run(origin, session, false, async (_tx, actor, state) => createProcessLibraryService({ state }).detail(id, origin, actor)),
    execute(input: unknown, session: Session) {
      const command = parseProcessLibraryCommand(input)
      return run(command.origin, session, true, async (tx, actor, state) => {
        const revision = state.revision
        const domain = createProcessLibraryService({ state })
        const result = domain.execute(command, actor)
        if (state.revision === revision)
          return result
        if (!Number.isSafeInteger(state.revision) || !Number.isSafeInteger(result.version))
          throw processLibraryProblem('unavailable', '工序库版本已超出安全范围，请停止保存。')
        const record = domain.detail(result.id, 'real', actor)
        const snapshot = processLibraryCanonical(record)
        const canonicalCommand = processLibraryCanonical(command)
        await tx.execute('INSERT INTO process_library_versions VALUES(?,?,?,?,?,?,?,?)', [record.id, record.code, record.version, record.sourceVersionId, snapshot, record.createdAt, actor.actorId, command.commandId])
        await tx.execute('INSERT INTO process_library_command_receipts VALUES(?,?,?,?,?,?,?,?)', [command.commandId, actor.workspaceId, actor.actorId, record.id, processLibraryDigest(canonicalCommand), canonicalCommand, processLibraryCanonical(result), record.createdAt])
        await tx.execute('INSERT INTO process_library_audits VALUES(?,?,?,?,?,?,?)', [randomUUID(), record.id, command.commandId, actor.actorId, 'create-version', snapshot, record.createdAt])
        await tx.execute('UPDATE process_library_revision SET revision=? WHERE singleton=1', [state.revision])
        return result
      })
    },
  }
}
