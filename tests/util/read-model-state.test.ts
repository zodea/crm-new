import { describe, expect, it } from 'vitest'
import { decodeProblemDTO, problemFromHttpFailure } from '~/lib/read-model/problem'
import { readFailureState, readProblemTitle, readStateData, readStateProblem } from '~/lib/read-model/state'

const unavailable = { code: 'unavailable' as const, message: '来源暂不可用', retryable: true, fieldErrors: {}, traceId: 'trace-read' }

describe('公共读取状态与错误语义', () => {
  it('读取成功与计算缺项是独立维度；可证数据不会变成另一种读取态', () => {
    const data = { value: null, status: 'partial', knownValue: '5.00' }
    const state = { kind: 'ready' as const, data }
    expect(readStateData(state)).toBe(data)
    expect(readStateProblem(state)).toBeNull()
    expect(state.kind).toBe('ready')
  })

  it('来源失败保留合法旧数据并公开失败原因，不成为空记录或已完成计算', () => {
    const prior = { id: 'current-target', value: '0.00' }
    const state = readFailureState(unavailable, prior)
    expect(state).toEqual({ kind: 'unavailable', problem: unavailable, previous: prior })
    expect(readStateData(state)).toBe(prior)
    expect(readStateProblem(state)).toBe(unavailable)
  })

  it.each(['unauthenticated', 'forbidden', 'not-found', 'relationship-mismatch'] as const)('%s 清除旧事实，保留真正错误分类', (code) => {
    const problem = { ...unavailable, code, retryable: false }
    const state = readFailureState(problem, { private: 'old-private-fact' })
    const kind = code === 'not-found' ? 'not-found' : code === 'relationship-mismatch' ? 'mismatch' : 'forbidden'
    expect(state).toEqual({ kind, problem })
    expect(readStateData(state)).toBeNull()
    expect(JSON.stringify(state)).not.toContain('old-private-fact')
  })

  it('普通故障仍为error，并区分401提示和403权限提示', () => {
    const problem = { ...unavailable, code: 'internal-error' as const }
    expect(readFailureState(problem, null)).toEqual({ kind: 'error', problem, previous: null })
    expect(readProblemTitle({ ...unavailable, code: 'unauthenticated' }, '客户读取失败')).toBe('登录已失效，请重新登录')
    expect(readProblemTitle({ ...unavailable, code: 'forbidden' }, '客户读取失败')).toBe('客户读取失败')
  })

  it('严格核验fieldErrors和trace，且不把传输额外字段带入公共问题', () => {
    expect(decodeProblemDTO({ ...unavailable, fieldErrors: { name: ['必须填写'] }, privateId: 'secret-id' })).toEqual({ ...unavailable, fieldErrors: { name: ['必须填写'] } })
    expect(decodeProblemDTO({ ...unavailable, fieldErrors: { name: '必须填写' } })).toBeNull()
    expect(decodeProblemDTO({ ...unavailable, fieldErrors: { name: [7] } })).toBeNull()
    expect(decodeProblemDTO({ ...unavailable, traceId: 3 })).toBeNull()
    expect(decodeProblemDTO({ ...unavailable, retryable: 'true' })).toBeNull()
  })

  it.each([401, 403] as const)('真实HTTP %s 即使坏载荷也不降格为可保旧数据的连接错误', (status) => {
    const problem = problemFromHttpFailure({ response: { status, _data: { data: { code: 'unavailable', message: 'secret-body', fieldErrors: [] } } } })!
    expect(problem.code).toBe(status === 401 ? 'unauthenticated' : 'forbidden')
    expect(problem.retryable).toBe(false)
    expect(problem.fieldErrors).toEqual({})
    expect(JSON.stringify(problem)).not.toContain('secret-body')
    expect(readStateData(readFailureState(problem, { private: 'old-private-fact' }))).toBeNull()
  })

  it('保留合法远端Problem和可重试503，不猜网络失败为退出或不存在', () => {
    expect(problemFromHttpFailure({ response: { status: 503, _data: { data: unavailable } } })).toEqual(unavailable)
    expect(problemFromHttpFailure({ statusCode: 401, data: { ...unavailable, code: 'unauthenticated', retryable: false } })).toEqual({ ...unavailable, code: 'unauthenticated', retryable: false })
    expect(problemFromHttpFailure(new Error('offline'))).toBeNull()
    expect(problemFromHttpFailure({ statusCode: 404 })).toBeNull()
  })
})
