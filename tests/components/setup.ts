import { cleanup } from '@testing-library/vue'
import { afterEach, beforeAll, vi } from 'vitest'

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
})
