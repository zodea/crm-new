import type { ReadState } from '~/types/read-model'
import { auxiliaryProblemFromUnknown } from '~/lib/auxiliary-contract/repository'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readFailureState, readStateData } from '~/lib/read-model/state'

export function useAuxiliaryContractRead<T>(
  read: () => Promise<T>,
  classify: (data: T) => ReadState<T> = data => ({ kind: 'ready', data }),
  options?: { snapshotKey: () => string },
) {
  const state = shallowRef<ReadState<T>>({ kind: 'idle' })
  const data = shallowRef<T | null>(null)
  let generation = 0
  let previousKey: string | undefined
  bindReadAuthority((problem) => {
    generation++
    previousKey = undefined
    data.value = null
    state.value = readFailureState<T>(problem, null)
  })
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
      state.value = readFailureState(problem, previous)
      data.value = readStateData(state.value)
    }
  }
  const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
  const shellState = computed(() => state.value.kind === 'idle' || state.value.kind === 'loading' ? 'loading' : state.value.kind === 'mismatch' ? 'not-found' : ['ready', 'empty'].includes(state.value.kind) ? 'ready' : state.value.kind === 'forbidden' ? 'forbidden' : state.value.kind === 'not-found' ? 'not-found' : 'error')
  onBeforeUnmount(() => generation++)
  return { state, data, problem, shellState, load }
}
