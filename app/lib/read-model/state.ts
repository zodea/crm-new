import type { ProblemDTO, ReadState } from '../../types/read-model'

export function readStateData<T>(state: ReadState<T>): T | null {
  if (state.kind === 'ready' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'unavailable' || state.kind === 'error')
    return state.previous
  return null
}

export function readStateProblem<T>(state: ReadState<T>): ProblemDTO | null {
  return 'problem' in state ? state.problem : null
}

export function readFailureState<T>(problem: ProblemDTO, previous: T | null): ReadState<T> {
  if (problem.code === 'unauthenticated' || problem.code === 'forbidden')
    return { kind: 'forbidden', problem }
  if (problem.code === 'not-found')
    return { kind: 'not-found', problem }
  if (problem.code === 'relationship-mismatch')
    return { kind: 'mismatch', problem }
  return problem.code === 'unavailable' ? { kind: 'unavailable', problem, previous } : { kind: 'error', problem, previous }
}

export function readProblemTitle(problem: ProblemDTO | null, fallback: string): string {
  return problem?.code === 'unauthenticated' ? '登录已失效，请重新登录' : fallback
}
