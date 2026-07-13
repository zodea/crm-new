// @unocss-include —— cva 变体类在本 .ts 内，UnoCSS 默认不扫纯 ts，此指令强制纳入提取。
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

// 变体样式全部走桥接后的语义类（bg-primary / text-primary-foreground / ring-ring …），
// 视觉继承 tokens.css 里已定的品牌/状态色，等同旧 KitUI 的 btn-* 观感。
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-14px font-600 cursor-pointer transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        outline: 'border border-input bg-card text-foreground hover:border-primary hover:text-primary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-muted',
        ghost: 'text-ink-soft hover:bg-muted hover:text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3.5 py-1.5',
        sm: 'h-7 px-2.5 text-13px',
        lg: 'h-10 px-6',
        icon: 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
