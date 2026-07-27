import process from 'node:process'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  devtools: { enabled: process.env.NUXT_DEVTOOLS !== 'false' },

  runtimeConfig: {
    // PaddleOCR 官方 API 凭证仅存在 Nitro 服务端；禁止放入 public 或前端持久化。
    paddleOcrAccessToken: '',
    paddleOcrBaseUrl: 'https://paddleocr.aistudio-app.com',
    paddleOcrRequestTimeoutMs: 120_000,
    paddleOcrPollTimeoutMs: 600_000,
    public: {
      // 仅由隔离的视觉回归配置置为 demo，测试会据此拒绝外部或未知数据环境。
      visualBaselineMode: '',
    },
  },

  modules: [
    '@unocss/nuxt',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@nuxt/eslint',
  ],

  eslint: {
    // 交给外部 eslint.config.mjs 的 antfu 配置组合，@nuxt/eslint 只提供
    // auto-import globals / Nuxt 专属规则，避免与 antfu 的 stylistic 规则冲突。
    config: {
      standalone: false,
    },
  },

  components: {
    dirs: [
      { path: '~/components', pathPrefix: false, extensions: ['vue'] },
    ],
  },

  css: [
    '@/assets/css/tokens.css',
  ],

  vite: {
    optimizeDeps: {
      // 预打包应用壳、交互原语、桌面桥接与按需导入依赖，避免 dev
      // 首次进入表单/导入路由时 Vite 发现新依赖并触发整页 reload。
      include: [
        '@tauri-apps/api/core',
        '@tauri-apps/api/path',
        '@tauri-apps/plugin-dialog',
        '@tauri-apps/plugin-fs',
        '@tauri-apps/plugin-sql',
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'class-variance-authority',
        'clsx',
        'reka-ui',
        'sql.js',
        'vue-sonner',
        'vxe-pc-ui',
        'vxe-table',
        'xlsx',
      ],
    },
  },

  app: {
    head: {
      title: '瑞航CRM',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        ...(process.env.NUXT_PUBLIC_VISUAL_BASELINE_MODE
          ? [{
              name: 'ruihang-data-profile',
              content: process.env.NUXT_PUBLIC_VISUAL_BASELINE_MODE,
            }]
          : []),
      ],
    },
  },
})
