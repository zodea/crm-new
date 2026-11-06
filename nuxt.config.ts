import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { isolatedFreshBuildPaths } from './scripts/e2e-isolation'

// 并行 E2E 的第二个 dev server 用独立构建目录与 Vite 依赖缓存，避免与默认 .nuxt 及共享 node_modules 缓存互相覆盖；未设置时保持默认。
const buildDir = process.env.NUXT_BUILD_DIR
const localOcrAssetsDirectory = process.env.CRM_LOCAL_OCR_ASSETS_DIRECTORY
const isolatedOutput = process.env.CRM_E2E_BUILD_OUTPUT_DIR
const isolatedPaths = isolatedOutput ? isolatedFreshBuildPaths(process.cwd(), buildDir ?? '', isolatedOutput) : null

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  ...(buildDir ? { buildDir: isolatedPaths?.build ?? buildDir } : {}),
  devtools: { enabled: process.env.NUXT_DEVTOOLS !== 'false' },

  nitro: {
    ...(isolatedPaths ? { output: { dir: isolatedPaths.output } } : {}),
    // PDF.js 读取中文文字型 PDF 时按需加载内置字符映射；打包与开发环境使用同一来源。
    publicAssets: [
      { dir: resolve('node_modules/pdfjs-dist/cmaps'), baseURL: '/pdfjs/cmaps' },
      ...(localOcrAssetsDirectory
        ? [
            { dir: `${localOcrAssetsDirectory}/ocr-models`, baseURL: '/local-ocr/models' },
            { dir: `${localOcrAssetsDirectory}/ocr-runtime`, baseURL: '/local-ocr/runtime' },
          ]
        : []),
    ],
    // sql.js 按运行时路径加载 WASM；显式携带现有依赖，构建后无需手工补文件。
    // xlsx 整包内联：外置时 Windows 开发态会把 dist/cpexcel.js 写成裸盘符路径，ESM 加载失败。
    externals: { traceInclude: [createRequire(resolve('package.json')).resolve('sql.js/dist/sql-wasm.wasm')], inline: [/[\\/]xlsx[\\/]/] },
  },

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
    ...(buildDir ? { cacheDir: `${buildDir}/vite` } : {}),
    resolve: {
      // pnpm 的隔离/提升链接都必须让应用与 @pinia/nuxt 共享同一运行时实例。
      dedupe: ['vue', 'pinia'],
    },
    optimizeDeps: {
      // 预打包应用壳、交互原语与按需导入依赖，避免 dev
      // 首次进入表单/导入路由时 Vite 发现新依赖并触发整页 reload。
      include: [
        '@vue/devtools-core',
        '@vue/devtools-kit',
        'class-variance-authority',
        'clsx',
        'errx',
        'pdfjs-dist/legacy/build/pdf.mjs',
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
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
