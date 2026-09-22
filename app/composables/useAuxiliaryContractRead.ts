import type { ReadState } from '~/types/read-model'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'

export function useAuxiliaryContractRead<T>(
  read: () => Promise<T>,
  classify: (data: T) => ReadState<T> = data => ({ kind: 'ready', data }),
  options?: { snapshotKey: () => string },
) {
  const state = shallowRef<ReadState<T>>({ kind: 'idle' })
  const data = shallowRef<T | null>(null)
  let generation = 0
  let previousKey: string | undefined
  async function load() {
    const current = ++generation
    const key = options?.snapshotKey()
    const previous = key !== undefined && key === previousKey ? data.value : null
    previousKey = key
    state.value = { kind: 'loading', previous }
    data.value = previous
    try {
      const value = await read()
      if (current !== generation)
        return
      data.value = value
      state.value = classify(value)
    }
    catch (cause) {
      if (current !== generation)
        return
      const problem = auxiliaryProblemFromUnknown(cause).problem
      const unavailableSource = ['forbidden', 'not-found', 'relationship-mismatch'].includes(problem.code)
      data.value = unavailableSource ? null : previous
      state.value = problem.code === 'forbidden'
        ? { kind: 'forbidden', problem }
        : problem.code === 'not-found'
          ? { kind: 'not-found', problem }
          : problem.code === 'relationship-mismatch'
            ? { kind: 'mismatch', problem }
            : { kind: 'error', problem, previous }
    }
  }
  const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
  const shellState = computed(() => state.value.kind === 'idle' || state.value.kind === 'loading' ? 'loading' : state.value.kind === 'mismatch' ? 'not-found' : ['ready', 'partial', 'empty'].includes(state.value.kind) ? 'ready' : state.value.kind === 'forbidden' ? 'forbidden' : state.value.kind === 'not-found' ? 'not-found' : 'error')
  onBeforeUnmount(() => generation++)
  return { state, data, problem, shellState, load }
}
