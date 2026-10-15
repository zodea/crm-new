import { describe, expect, it } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import { useInvoiceRegionTarget } from '~/composables/useInvoiceRegionTarget'

describe('useInvoiceRegionTarget 点字段定位', () => {
  it('宽屏：失焦撤回保持，悬停临时覆盖', () => {
    const target = useInvoiceRegionTarget()
    target.locate('invoiceNumber')
    target.preview('totalAmount')
    expect(target.active.value).toBe('totalAmount')
    target.preview(null)
    target.release('invoiceNumber')
    expect(target.active.value).toBeNull()
  })

  it('窄屏切到原件面板时恢复最近一次定位，切回后按新焦点更新', async () => {
    const sourceShown = shallowRef(false)
    const target = useInvoiceRegionTarget({ revealLast: sourceShown })
    target.locate('invoiceNumber')
    // 点“原件”分段：输入框先失焦，再切面板
    target.release('invoiceNumber')
    expect(target.active.value).toBeNull()
    sourceShown.value = true
    await nextTick()
    expect(target.active.value).toBe('invoiceNumber')

    sourceShown.value = false
    await nextTick()
    expect(target.active.value).toBeNull()
    target.locate('totalAmount')
    target.release('totalAmount')
    sourceShown.value = true
    await nextTick()
    expect(target.active.value).toBe('totalAmount')
  })

  it('指针切换先换面板后失焦：失焦不撤回已恢复的定位', () => {
    const sourceShown = shallowRef(false)
    const target = useInvoiceRegionTarget({ revealLast: sourceShown })
    target.locate('invoiceDate')
    sourceShown.value = true
    target.release('invoiceDate')
    expect(target.active.value).toBe('invoiceDate')
  })

  it('reset 后不再恢复旧定位', async () => {
    const sourceShown = shallowRef(false)
    const target = useInvoiceRegionTarget({ revealLast: sourceShown })
    target.locate('invoiceNumber')
    target.release('invoiceNumber')
    target.reset()
    sourceShown.value = true
    await nextTick()
    expect(target.active.value).toBeNull()
  })
})
