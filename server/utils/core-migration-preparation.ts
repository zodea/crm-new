import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'

export interface PreparedCoreMigration {
  /** 先完成同步领域校验，再连续切换事实；调用方须在同一同步段更新 authority。 */
  commit: () => void
  abort: () => void | Promise<void>
}

export interface CoreMigrationSynchronousSource {
  prepareMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => () => void
}

export interface CoreMigrationAsynchronousSource {
  prepareMigrationSnapshot: (snapshot: CoreMigrationSnapshotDTO) => Promise<PreparedCoreMigration>
}

/** SQL 等候期间不捕获其他领域的旧 Map，所有准备成功后才交付一次同步提交。 */
export async function prepareCoreMigrationCommandSources(
  snapshot: CoreMigrationSnapshotDTO,
  sources: readonly CoreMigrationSynchronousSource[],
  asynchronousSources: readonly CoreMigrationAsynchronousSource[] = [],
): Promise<PreparedCoreMigration> {
  const prepared: PreparedCoreMigration[] = []
  let finished = false
  async function abort() {
    if (finished)
      return
    finished = true
    const results = await Promise.allSettled(prepared.map(source => source.abort()))
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length)
      throw new AggregateError(failures.map(result => result.reason), '迁移准备资源释放失败')
  }
  try {
    for (const source of asynchronousSources)
      prepared.push(await source.prepareMigrationSnapshot(snapshot))
    return {
      commit() {
        if (finished)
          return
        const commits = sources.map(source => source.prepareMigrationSnapshot(snapshot))
        finished = true
        for (const commit of commits)
          commit()
        for (const source of prepared)
          source.commit()
      },
      abort,
    }
  }
  catch (cause) {
    try {
      await abort()
    }
    catch (cleanupFailure) { throw new AggregateError([cause, cleanupFailure], '迁移准备失败，释放资源时另有错误', { cause }) }
    throw cause
  }
}
