export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  devtools: { enabled: true },

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
