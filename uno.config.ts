import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetWind3,
} from 'unocss'

export default defineConfig({
  // shadcn 组件的 cva 变体字符串在 index.ts 里（官方 registry 结构），
  // UnoCSS 默认管线不扫纯 .ts —— 显式纳入 ui 目录的 .ts，否则变体类不生成。
  content: {
    filesystem: ['app/components/ui/**/*.ts'],
  },

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
      sidebar: {
        'DEFAULT': 'var(--sidebar-background)',
        'foreground': 'var(--sidebar-foreground)',
        'primary': 'var(--sidebar-primary)',
        'primary-foreground': 'var(--sidebar-primary-foreground)',
        'accent': 'var(--sidebar-accent)',
        'accent-foreground': 'var(--sidebar-accent-foreground)',
        'border': 'var(--sidebar-border)',
        'ring': 'var(--sidebar-ring)',
      },
    },

    // 统一形状阶梯：交互控件 10px、卡片/弹窗 12px、小控件 8px。
    borderRadius: {
      lg: 'var(--radius-card)',
      md: 'var(--radius-btn)',
      sm: 'var(--radius-sm)',
      xl: 'calc(var(--radius-card) + 2px)',
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
    // 居中对话框专用：把 -50%/-48% 的居中位移烘进 enter/exit 偏移，
    // 避免动画的 transform 覆盖 -translate-x/y-1/2 居中导致跳位（zoom+fade+微升，始终居中）
    ['dialog-in', { '--enter-opacity': '0', '--enter-scale': '0.96', '--enter-translate-x': '-50%', '--enter-translate-y': '-48%' }],
    ['dialog-out', { '--exit-opacity': '0', '--exit-scale': '0.96', '--exit-translate-x': '-50%', '--exit-translate-y': '-48%' }],
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

    // L1 卡片底座（DESIGN-TASTE §4.1 / ADR 0007，#110 B1）：一切内容容器的唯一配方，
    // 内边距由调用处按 12–16 自持（表格卡 0 + overflow-hidden）；卡内不再嵌套圆角阴影。
    // 可点卡片叠加 panel-hover（hover 边转 brand + 阴影升级）。
    'panel': 'border border-line rounded-[var(--radius-card)] bg-panel shadow-[var(--shadow-card)]',
    'panel-hover': 'transition-[border-color,box-shadow] duration-[var(--dur-fast)] hover:border-brand hover:shadow-[var(--shadow-pop)]',

    // 按钮：五变体层级语言（权威源 DESIGN-TASTE §4.2，#109）。
    // 缺省 = btn-secondary 安静按钮；实心蓝只属于 btn-accent（每屏 ≤1 枚核心 CTA）；
    // btn-danger = 静默红（破坏性防护在确认弹窗，ADR 0003）；hover 平面变色、active scale(0.97)。
    // btn-look-* 是五变体外观的唯一定义处：shadcn Button 的 cva 变体表（ui/button/index.ts）
    // 直接引用同名类，几何/交互基座由各轨自持；hover 色值见 tokens.css --btn-hover-*。
    // 过渡只列颜色/透明度/位移——不用裸 transition，避免 focus 环的 box-shadow 被拖进过渡逐帧重绘。
    // 不加 disabled:pointer-events-none：禁用按钮要保留 title 提示（如「缺归属…」）的悬停可达性。
    'btn-look-secondary': 'border-line-strong bg-panel text-ink hover:bg-[var(--btn-hover-quiet)] hover:border-ink-soft',
    'btn-look-primary': 'border-brand bg-brand-soft text-brand-deep hover:bg-[var(--btn-hover-primary)]',
    'btn-look-accent': 'border-brand bg-brand text-white hover:opacity-90',
    'btn-look-ghost': 'border-transparent bg-transparent text-ink-soft hover:bg-brand-soft hover:text-brand',
    'btn-look-danger': 'border-line-strong bg-panel text-danger hover:border-danger hover:bg-[var(--btn-hover-danger)]',
    'btn': 'inline-flex items-center justify-center whitespace-nowrap border rounded-[var(--radius-btn)] px-[12px] py-[7px] text-13px font-600 cursor-pointer transition-[color,background-color,border-color,opacity,transform] duration-[var(--dur-fast)] active:scale-97 disabled:opacity-50',
    'btn-secondary': 'btn btn-look-secondary',
    'btn-primary': 'btn btn-look-primary',
    'btn-accent': 'btn btn-look-accent',
    'btn-ghost': 'btn btn-look-ghost',
    'btn-danger': 'btn btn-look-danger',

    // 图标按钮（工具栏）
    'icon-btn': 'inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-btn)] border border-line bg-panel text-ink-soft cursor-pointer hover:border-brand hover:text-brand transition-colors duration-[var(--dur-fast)]',
    'icon-btn-accent': 'icon-btn bg-brand text-white border-brand',
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
    'field-input': 'border border-line rounded-[var(--radius-btn)] px-2.5 py-1.5 bg-panel text-14px outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--brand-ring)]',

    // 标签
    'field-label': 'text-12px font-600 text-ink-soft mb-1',

    // 表单分组标题（大表单左侧分区锚点对应的分组抬头）
    'field-group-title': 'text-13px font-800 text-brand-deep mb-3',

    // 列组切换（CRM 风格）
    'col-group': 'flex border border-line rounded-[var(--radius-btn)] overflow-hidden bg-panel',
    'col-group-item': 'px-3 py-1 text-12px font-600 text-ink-soft cursor-pointer border-r border-line last:border-r-0',
    'col-group-active': 'bg-brand text-white',

    // 内容区 Tab
    'content-tab': 'px-3.5 py-2 text-13px text-ink-soft cursor-pointer border-b-2 border-transparent -mb-px hover:text-brand',
    'content-tab-active': 'text-brand-deep border-b-brand font-600',

    // 信息摘要行
    'info-row': 'flex border border-line',
    'info-cell': 'flex-1 px-3 py-2 border-r border-line last:border-r-0',

    // 表单网格
    'form-grid': 'grid grid-cols-3 border border-line bg-panel',
    'form-cell': 'px-2.5 py-2 border-b border-r border-surface-3 flex flex-col gap-0.5 [&:nth-child(3n)]:border-r-0',

    // 分页
    'pager-btn': 'inline-flex items-center justify-center w-7 h-7 border border-line rounded-[var(--radius-sm)] bg-panel text-12px text-ink-soft cursor-pointer hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-45',
    'pager-active': 'bg-brand text-white border-brand',
  },
})
