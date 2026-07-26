import type { ComputedRef, CSSProperties, MaybeRefOrGetter } from 'vue'
import { createGlobalState } from '@vueuse/core'
import { computed, inject, onScopeDispose, provide, shallowRef, toValue, watch } from 'vue'

type OverlayLayerStyle = CSSProperties & {
  '--overlay-layer-offset': string
}

const OVERLAY_LAYER_OFFSET_KEY = Symbol('overlay-layer-offset')
const MODAL_LAYER_STEP = 10

function layerStyle(offset: number): OverlayLayerStyle {
  return {
    '--overlay-layer-offset': String(offset),
  }
}

const useOverlayStackState = createGlobalState(() => {
  const modalIds = shallowRef<readonly symbol[]>([])

  const activeModalCount = computed(() => modalIds.value.length)
  const hasActiveModal = computed(() => activeModalCount.value > 0)

  function setModalOpen(id: symbol, open: boolean) {
    const index = modalIds.value.indexOf(id)
    if (open && index < 0)
      modalIds.value = [...modalIds.value, id]
    else if (!open && index >= 0)
      modalIds.value = modalIds.value.filter(candidate => candidate !== id)
  }

  function modalLayerOffset(id: symbol) {
    return computed(() => {
      const index = modalIds.value.indexOf(id)
      return Math.max(index, 0) * MODAL_LAYER_STEP
    })
  }

  return {
    activeModalCount,
    hasActiveModal,
    modalLayerOffset,
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
  const { modalLayerOffset, setModalOpen } = useOverlayStackState()
  const offset = modalLayerOffset(id)
  const style = computed(() => layerStyle(offset.value))

  provide(OVERLAY_LAYER_OFFSET_KEY, offset)

  watch(
    () => toValue(open),
    value => setModalOpen(id, value),
    { flush: 'sync', immediate: true },
  )

  onScopeDispose(() => setModalOpen(id, false))

  return {
    layerStyle: style,
  }
}

export function useOwnedOverlayLayerStyle() {
  const offset = inject<ComputedRef<number>>(
    OVERLAY_LAYER_OFFSET_KEY,
    computed(() => 0),
  )
  return computed(() => layerStyle(offset.value))
}
