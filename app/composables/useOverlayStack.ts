import type { MaybeRefOrGetter } from 'vue'
import { createGlobalState } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'

const useOverlayStackState = createGlobalState(() => {
  const modalIds = shallowRef<ReadonlySet<symbol>>(new Set())

  const activeModalCount = computed(() => modalIds.value.size)
  const hasActiveModal = computed(() => activeModalCount.value > 0)

  function setModalOpen(id: symbol, open: boolean) {
    const next = new Set(modalIds.value)
    if (open)
      next.add(id)
    else
      next.delete(id)
    modalIds.value = next
  }

  return {
    activeModalCount,
    hasActiveModal,
    setModalOpen,
  }
})

export function useOverlayStack() {
  const { activeModalCount, hasActiveModal } = useOverlayStackState()
  return {
    activeModalCount,
    hasActiveModal,
  }
}

export function useModalLayerRegistration(open: MaybeRefOrGetter<boolean>) {
  const id = Symbol('modal-layer')
  const { setModalOpen } = useOverlayStackState()

  watch(
    () => toValue(open),
    value => setModalOpen(id, value),
    { flush: 'sync', immediate: true },
  )

  onScopeDispose(() => setModalOpen(id, false))
}
