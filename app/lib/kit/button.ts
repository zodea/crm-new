export type KitButtonPhase = 'default' | 'loading' | 'success'
export type KitButtonVariant = 'brand' | 'danger' | 'ghost'

export interface KitButtonState {
  phase: KitButtonPhase
  disabled: boolean
  lockWidth: boolean
  showSpinner: boolean
  showCheck: boolean
}

export interface ResolveKitButtonStateOptions {
  disabled?: boolean
  loading?: boolean
  success?: boolean
}

export function resolveKitButtonState(
  options: ResolveKitButtonStateOptions = {},
): KitButtonState {
  if (options.loading) {
    return {
      phase: 'loading',
      disabled: true,
      lockWidth: true,
      showSpinner: true,
      showCheck: false,
    }
  }

  if (options.success) {
    return {
      phase: 'success',
      disabled: true,
      lockWidth: true,
      showSpinner: false,
      showCheck: true,
    }
  }

  return {
    phase: 'default',
    disabled: options.disabled ?? false,
    lockWidth: false,
    showSpinner: false,
    showCheck: false,
  }
}
