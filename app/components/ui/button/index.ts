// @unocss-include —— cva 变体类在本 .ts 内，UnoCSS 默认不扫纯 ts，此指令强制纳入提取。
import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

// 五变体层级语言（权威源 KitUI §06，#109）：
// 缺省 = secondary 描边白底安静按钮；实心蓝只属于 accent（每屏 ≤1 枚核心 CTA）；
// destructive = 静默红（破坏性防护在确认弹窗，ADR 0003，按钮不必嘶吼）。
// 五变体外观唯一源 = uno.config.ts 的 btn-look-* shortcuts（本文件被 UnoCSS 扫描，直接引用即可生成），
// 本表只保留几何/交互基座与 shadcn 兼容档。过渡属性显式列出，避免 focus 环 box-shadow 被拖进过渡。
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap border rounded-md font-600 cursor-pointer transition-[color,background-color,border-color,opacity,transform] duration-[var(--dur-fast)] active:scale-97 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        secondary: 'btn-look-secondary',
        primary: 'btn-look-primary',
        accent: 'btn-look-accent',
        ghost: 'btn-look-ghost',
        destructive: 'btn-look-danger',
        // shadcn 兼容档：outline 与 secondary 同外观（存量调用点保留），link 维持文字链
        outline: 'btn-look-secondary',
        link: 'border-transparent bg-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 尺寸全用 px 字面量：html 根字号 14px，rem 阶会把 12px/16px/28px 缩水
        default: 'px-[12px] py-[7px] text-13px',
        sm: 'px-[11px] py-[5px] text-12px',
        lg: 'px-[16px] py-[9px] text-14px',
        icon: 'h-[28px] w-[28px] p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
