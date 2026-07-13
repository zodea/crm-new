import { describe, expect, it } from 'vitest'
import { resolveKitButtonState } from '~/lib/kit/button'

describe('kitButton 状态', () => {
  it('默认态可点击且不锁定宽度', () => {
    expect(resolveKitButtonState()).toEqual({
      phase: 'default',
      disabled: false,
      lockWidth: false,
      showSpinner: false,
      showCheck: false,
    })
  })

  it('loading 态立即禁用、锁定宽度并显示 spinner', () => {
    expect(resolveKitButtonState({ loading: true })).toEqual({
      phase: 'loading',
      disabled: true,
      lockWidth: true,
      showSpinner: true,
      showCheck: false,
    })
  })

  it('success 态保持锁宽并只显示完成勾', () => {
    expect(resolveKitButtonState({ success: true })).toEqual({
      phase: 'success',
      disabled: true,
      lockWidth: true,
      showSpinner: false,
      showCheck: true,
    })
  })

  it('业务禁用不伪装成 loading 或 success', () => {
    expect(resolveKitButtonState({ disabled: true })).toEqual({
      phase: 'default',
      disabled: true,
      lockWidth: false,
      showSpinner: false,
      showCheck: false,
    })
  })

  it('loading 与 success 短暂重叠时以进行中为准', () => {
    expect(resolveKitButtonState({ loading: true, success: true }).phase).toBe('loading')
  })
})
