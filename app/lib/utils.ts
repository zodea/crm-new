import { clsx, type ClassValue } from 'clsx'

/**
 * class 合并（UnoCSS 版）——仅用 clsx，**不依赖 tailwind-merge**。
 * shadcn/reka-ui 组件的样式覆盖走 cva 变体属性，而非 class 字符串对冲，
 * 这样避免运行时字符串魔法，冲突在 variant 层解决（UnoCSS 更干净的用法）。
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
