// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  consumeDataVisibilitySwitch,
  DATA_VISIBILITY_PENDING_KEY,
  stageDataVisibilitySwitch,
} from '~/lib/data-visibility'
import { useDataVisibilityStore } from '~/stores/data-visibility'

describe('global data visibility preference', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to production-only and only applies a server-authorized demo opt-in', async () => {
    const first = useDataVisibilityStore()
    expect(first.includeDemo).toBe(false)

    stageDataVisibilitySwitch(sessionStorage, true)
    await first.initialize(vi.fn().mockResolvedValue(true))
    await nextTick()
    expect(first.includeDemo).toBe(true)
    expect(localStorage.getItem('ruihang:workspace-default:include-demo')).toBe('true')

    setActivePinia(createPinia())
    const restored = useDataVisibilityStore()
    expect(restored.includeDemo).toBe(false)
    await restored.initialize(vi.fn().mockResolvedValue(true))
    expect(restored.includeDemo).toBe(true)
  })

  it('clears a forged preference when the server denies demo capability', async () => {
    localStorage.setItem('ruihang:workspace-default:include-demo', 'true')
    const store = useDataVisibilityStore()

    await store.initialize(vi.fn().mockResolvedValue(false))

    expect(store.includeDemo).toBe(false)
    expect(localStorage.getItem('ruihang:workspace-default:include-demo')).toBe('false')
  })

  it('can reset the presentation preference at a workspace/session boundary', async () => {
    const store = useDataVisibilityStore()
    stageDataVisibilitySwitch(sessionStorage, true)
    await store.initialize(vi.fn().mockResolvedValue(true))
    expect(store.includeDemo).toBe(true)

    store.reset()
    await nextTick()

    expect(store.includeDemo).toBe(false)
    expect(localStorage.getItem('ruihang:workspace-default:include-demo')).toBe('false')
  })

  it('stages a switch separately and consumes it only in the next app instance', () => {
    stageDataVisibilitySwitch(sessionStorage, true)

    expect(localStorage.getItem('ruihang:workspace-default:include-demo')).toBeNull()
    expect(sessionStorage.getItem(DATA_VISIBILITY_PENDING_KEY)).toBe('true')
    expect(consumeDataVisibilitySwitch(sessionStorage)).toBe(true)
    expect(sessionStorage.getItem(DATA_VISIBILITY_PENDING_KEY)).toBeNull()
  })
})
