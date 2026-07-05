import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWind3,
} from 'unocss'

export default defineConfig({
  presets: [
    presetWind3(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],

  theme: {
    colors: {
      brand: {
        DEFAULT: 'var(--brand)',
        deep: 'var(--brand-deep)',
        soft: 'var(--brand-soft)',
      },
      ok: {
        DEFAULT: 'var(--ok)',
        soft: 'var(--ok-soft)',
        ink: 'var(--ok-ink)',
      },
      warn: {
        DEFAULT: 'var(--warn)',
        soft: 'var(--warn-soft)',
        ink: 'var(--warn-ink)',
      },
      danger: {
        DEFAULT: 'var(--danger)',
        soft: 'var(--danger-soft)',
        ink: 'var(--danger-ink)',
      },
      ink: {
        DEFAULT: 'var(--ink)',
        soft: 'var(--ink-soft)',
        faint: 'var(--ink-faint)',
      },
      bg: 'var(--bg)',
      panel: 'var(--panel)',
      surface: {
        2: 'var(--surface-2)',
        3: 'var(--surface-3)',
        sink: 'var(--surface-sink)',
      },
      line: {
        DEFAULT: 'var(--line)',
        strong: 'var(--line-strong)',
      },

      // ── shadcn-vue 语义色（桥接 tokens.css，供 reka-ui/shadcn 组件消费）──
      // 全走 var(--x) 完整色值约定（非 hsl 三元组），复用现有设计令牌、不重做原子样式。
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
      popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
      primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
      secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
      muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
      accent: { DEFAULT: 'var(--accent)', foreground: 'var(--accent-foreground)' },
      destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
      border: 'var(--border)',
      input: 'var(--input)',
      ring: 'var(--ring)',
    },

    // shadcn 圆角阶梯（lg = --radius，其余派生）；旧的 rounded-[3px]/rounded-full 不受影响
    borderRadius: {
      lg: 'var(--radius)',
      md: 'calc(var(--radius) - 2px)',
      sm: 'calc(var(--radius) - 4px)',
      xl: 'calc(var(--radius) + 4px)',
    },

    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },

  // ── reka-ui / shadcn 进出动画（tailwindcss-animate 的 UnoCSS 原生移植，无 Tailwind 依赖）──
  // 注册为 rules，data-[state=open]:animate-in 这类变体才能被 UnoCSS 识别生成。
  // 时长/缓动接项目令牌，keyframes 见下方 preflights。
  rules: [
    ['animate-in', {
      'animation-name': 'enter',
      'animation-duration': 'var(--dur-dialog, 220ms)',
      'animation-timing-function': 'var(--ease-snappy)',
      '--enter-opacity': 'initial',
      '--enter-scale': 'initial',
      '--enter-translate-x': 'initial',
      '--enter-translate-y': 'initial',
    }],
    ['animate-out', {
      'animation-name': 'exit',
      'animation-duration': 'var(--dur-dialog, 220ms)',
      'animation-timing-function': 'var(--ease-snappy)',
      '--exit-opacity': 'initial',
      '--exit-scale': 'initial',
      '--exit-translate-x': 'initial',
      '--exit-translate-y': 'initial',
    }],
    ['fade-in-0', { '--enter-opacity': '0' }],
    ['fade-out-0', { '--exit-opacity': '0' }],
    ['zoom-in-95', { '--enter-scale': '0.95' }],
    ['zoom-out-95', { '--exit-scale': '0.95' }],
    ['slide-in-from-top-2', { '--enter-translate-y': '-0.5rem' }],
    ['slide-in-from-bottom-2', { '--enter-translate-y': '0.5rem' }],
    ['slide-in-from-left-2', { '--enter-translate-x': '-0.5rem' }],
    ['slide-in-from-right-2', { '--enter-translate-x': '0.5rem' }],
    ['slide-out-to-top-2', { '--exit-translate-y': '-0.5rem' }],
    ['slide-out-to-bottom-2', { '--exit-translate-y': '0.5rem' }],
    ['slide-out-to-left-2', { '--exit-translate-x': '-0.5rem' }],
    ['slide-out-to-right-2', { '--exit-translate-x': '0.5rem' }],
    ['slide-in-from-left', { '--enter-translate-x': '-100%' }],
    ['slide-in-from-right', { '--enter-translate-x': '100%' }],
    ['slide-in-from-top', { '--enter-translate-y': '-100%' }],
    ['slide-in-from-bottom', { '--enter-translate-y': '100%' }],
    ['slide-out-to-left', { '--exit-translate-x': '-100%' }],
    ['slide-out-to-right', { '--exit-translate-x': '100%' }],
    ['slide-out-to-top', { '--exit-translate-y': '-100%' }],
    ['slide-out-to-bottom', { '--exit-translate-y': '100%' }],
  ],

  preflights: [
    {
      getCSS: () => `
@keyframes enter {
  from {
    opacity: var(--enter-opacity, 1);
    transform: translate3d(var(--enter-translate-x, 0), var(--enter-translate-y, 0), 0)
      scale3d(var(--enter-scale, 1), var(--enter-scale, 1), 1);
  }
}
@keyframes exit {
  to {
    opacity: var(--exit-opacity, 1);
    transform: translate3d(var(--exit-translate-x, 0), var(--exit-translate-y, 0), 0)
      scale3d(var(--exit-scale, 1), var(--exit-scale, 1), 1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .animate-in, .animate-out { animation: none !important; }
}
`,
    },
  ],

  shortcuts: {
    // 侧边栏面板（毛玻璃）
    'sidebar-panel': 'border border-line rounded-[var(--radius-card)] bg-[rgb(255_255_255/82%)] backdrop-blur-[12px] shadow-[var(--sidebar-shadow)]',

    // 内容区面板（扁平）
    'content-panel': 'border border-line bg-panel',

    // 按钮
    'btn': 'inline-flex items-center justify-center border border-line rounded-[3px] px-2.5 py-1.5 text-13px font-600 cursor-pointer transition-colors duration-[var(--dur-fast)]',
    'btn-primary': 'btn border-brand bg-brand text-white hover:opacity-90',
    'btn-secondary': 'btn bg-panel text-ink-soft hover:border-brand hover:text-brand',
    'btn-danger': 'btn border-danger text-danger hover:bg-danger-soft',
    'btn-ghost': 'btn border-transparent bg-transparent text-ink-soft hover:bg-surface-3 hover:text-brand',

    // 图标按钮（工具栏）
    'icon-btn': 'inline-flex items-center justify-center w-7 h-7 rounded-[3px] border border-line bg-panel text-ink-soft cursor-pointer hover:border-brand hover:text-brand transition-colors duration-[var(--dur-fast)]',
    'icon-btn-primary': 'icon-btn bg-brand text-white border-brand',
    'icon-btn-danger': 'icon-btn hover:border-danger hover:text-danger',

    // Chip
    'chip': 'inline-flex items-center rounded-full px-2.5 py-0.5 text-11px font-600 leading-none',
    'chip-ok': 'chip bg-ok-soft text-ok-ink',
    'chip-warn': 'chip bg-warn-soft text-warn-ink',
    'chip-danger': 'chip bg-danger-soft text-danger-ink',
    'chip-brand': 'chip bg-brand-soft text-brand-deep',

    // 状态文字（列表页纯文字颜色）
    'status-ok': 'text-ok font-600',
    'status-warn': 'text-warn font-600',
    'status-danger': 'text-danger font-600',

    // 输入框
    'field-input': 'border border-line rounded-[3px] px-2 py-1.5 bg-panel text-13px outline-none focus:border-brand focus:shadow-[0_0_0_2px_rgba(57,118,198,0.15)]',

    // 标签
    'field-label': 'text-11px font-600 text-ink-soft mb-1',

    // 列组切换（CRM 风格）
    'col-group': 'flex border border-line rounded-[3px] overflow-hidden bg-panel',
    'col-group-item': 'px-3 py-1 text-11px font-600 text-ink-soft cursor-pointer border-r border-line last:border-r-0',
    'col-group-active': 'bg-brand text-white',

    // 内容区 Tab
    'content-tab': 'px-3.5 py-2 text-12px text-ink-soft cursor-pointer border-b-2 border-transparent -mb-px hover:text-brand',
    'content-tab-active': 'text-brand-deep border-b-brand font-600',

    // 信息摘要行
    'info-row': 'flex border border-line',
    'info-cell': 'flex-1 px-3 py-2 border-r border-line last:border-r-0',

    // 表单网格
    'form-grid': 'grid grid-cols-3 border border-line bg-panel',
    'form-cell': 'px-2.5 py-2 border-b border-r border-surface-3 flex flex-col gap-0.5 nth-child-3n:border-r-0',

    // 分页
    'pager-btn': 'inline-flex items-center justify-center w-6 h-6 border border-line rounded-[3px] bg-panel text-11px text-ink-soft cursor-pointer hover:border-brand hover:text-brand',
    'pager-active': 'bg-brand text-white border-brand',
  },
})
