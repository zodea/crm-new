export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  devtools: { enabled: true },

  runtimeConfig: {
    // PaddleOCR 官方 API 凭证仅存在 Nitro 服务端；禁止放入 public 或前端持久化。
    paddleOcrAccessToken: '',
    paddleOcrBaseUrl: 'https://paddleocr.aistudio-app.com',
    paddleOcrRequestTimeoutMs: 120_000,
    paddleOcrPollTimeoutMs: 600_000,
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
      // xlsx 只被导入/导出页签按需加载；预打包避免 dev 首次进入这些
      // 路由时 Vite 发现新依赖触发整页 reload（会打断 SPA 页签导航）。
      include: ['xlsx'],
    },
  },

  app: {
    head: {
      title: '瑞航CRM',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
