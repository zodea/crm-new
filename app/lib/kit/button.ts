export type KitButtonPhase = 'default' | 'loading' | 'success'

// 五变体层级（KitUI §06）：secondary 缺省安静按钮 → primary 区块内主操作 → accent 每屏一枚章
export type KitButtonVariant = 'secondary' | 'primary' | 'accent' | 'ghost' | 'danger'

// Kit 层叫 danger（业务语义），shadcn 底座叫 destructive——唯一需要换名的档位
export function resolveKitButtonVariant(variant: KitButtonVariant = 'secondary') {
  return variant === 'danger' ? 'destructive' as const : variant
}

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
