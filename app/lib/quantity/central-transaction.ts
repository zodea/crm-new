import type { TransactionDb } from '../db/coordinator'
import { isProblemCodeDTO } from '../../types/read-model'
import { quantityProblem, QuantityRepositoryProblem } from './central-contract'

export interface QuantityDatabase {
  withTransaction: <T>(work: (db: TransactionDb) => Promise<T>) => Promise<T>
}

function storageFailure(cause: unknown) {
  return new QuantityRepositoryProblem(quantityProblem('unavailable', '工程量数据读取或保存失败，请重试').problem, { cause })
}

/** 将 SQL 故障与领域校验分开，同时保留原有同连接事务及错误诊断链。 */
export async function quantityTransaction<T>(database: QuantityDatabase, work: (db: TransactionDb) => Promise<T>): Promise<T> {
  try {
    return await database.withTransaction(async (raw) => {
      const db: TransactionDb = {
        async execute(sql, params) {
          try {
            await raw.execute(sql, params)
          }
          catch (cause) { throw storageFailure(cause) }
        },
        async select<TResult>(sql: string, params?: unknown[]): Promise<TResult[]> {
          try {
            return await raw.select<TResult>(sql, params)
          }
          catch (cause) { throw storageFailure(cause) }
        },
      }
      try {
        return await work(db)
      }
      catch (cause) {
        if (cause instanceof QuantityRepositoryProblem)
          throw cause
        if (cause instanceof Error && 'problem' in cause && cause.problem && typeof cause.problem === 'object'
          && 'code' in cause.problem && isProblemCodeDTO(cause.problem.code)
          && 'message' in cause.problem && typeof cause.problem.message === 'string') {
          throw new QuantityRepositoryProblem(quantityProblem(cause.problem.code, cause.problem.message).problem, { cause })
        }
        if (cause instanceof Error && cause.constructor === Error)
          throw new QuantityRepositoryProblem(quantityProblem('validation-failed', cause.message).problem, { cause })
        throw storageFailure(cause)
      }
    })
  }
  catch (cause) {
    if (cause instanceof QuantityRepositoryProblem)
      throw cause
    throw storageFailure(cause)
  }
}
